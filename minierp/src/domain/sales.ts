import { Ctx, getSetting, nextNumber, requireDate } from './context';
import { addDays, diffDays } from './dates';
import { DomainError } from './errors';
import { LineAmounts, lineAmounts, requireCents, requireQuantity, sumAmounts } from './money';
import { getContact } from './contacts';
import { getProduct } from './products';
import { addMove } from './stock';

export type SalesStatus = 'draft' | 'confirmed' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'overdue' | 'void';

export interface SalesLine {
  id: number;
  order_id: number;
  product_id: number;
  qty: number;
  unit_price_cents: number;
  tax_bps: number;
  unit_cost_cents: number;
  sku: string;
  product_name: string;
  amounts: LineAmounts;
}

export interface SalesOrder {
  id: number;
  number: string;
  customer_id: number;
  customer_name: string;
  status: SalesStatus;
  order_date: string;
  note: string;
  lines: SalesLine[];
  totals: LineAmounts;
  invoice: InvoiceSummary | null;
}

export interface InvoiceSummary {
  id: number;
  number: string;
  status: InvoiceStatus;
  total_cents: number;
  balance_cents: number;
}

export interface SalesLineInput {
  productId: number;
  qty: number;
  /** Leave out to use the product's current price. A different value is a per-order discount or surcharge. */
  unitPriceCents?: number;
}

export interface SalesOrderInput {
  customerId: number;
  date?: string;
  note?: string;
  lines: SalesLineInput[];
}

type LineRow = Omit<SalesLine, 'amounts'>;

function loadLines(ctx: Ctx, orderId: number): SalesLine[] {
  return ctx.db
    .all<LineRow>(
      `SELECT l.*, p.sku, p.name AS product_name
         FROM sales_order_lines l JOIN products p ON p.id = l.product_id
        WHERE l.order_id = ? ORDER BY l.id`,
      [orderId],
    )
    .map((row) => ({ ...row, amounts: lineAmounts(row.qty, row.unit_price_cents, row.tax_bps) }));
}

function writeLines(ctx: Ctx, orderId: number, lines: SalesLineInput[]): void {
  if (lines.length === 0) throw new DomainError('no_lines');
  for (const line of lines) {
    requireQuantity(line.qty);
    const product = getProduct(ctx, line.productId);
    if (!product.active) throw new DomainError('wrong_status', { what: 'product', status: 'archived' });
    const price = line.unitPriceCents === undefined ? product.price_cents : requireCents(line.unitPriceCents, 'price');
    ctx.db.run(
      'INSERT INTO sales_order_lines (order_id, product_id, qty, unit_price_cents, tax_bps) VALUES (?, ?, ?, ?, ?)',
      [orderId, line.productId, line.qty, price, product.tax_bps],
    );
  }
}

function requireCustomer(ctx: Ctx, id: number): void {
  if (getContact(ctx, id).kind !== 'customer') throw new DomainError('not_found', { what: 'customer', id });
}

export function createSalesOrder(ctx: Ctx, input: SalesOrderInput): number {
  requireCustomer(ctx, input.customerId);
  const date = requireDate(input.date ?? ctx.today());
  return ctx.db.transaction(() => {
    const number = nextNumber(ctx, 'SO', date);
    const id = ctx.db.run(
      "INSERT INTO sales_orders (number, customer_id, status, order_date, note) VALUES (?, ?, 'draft', ?, ?)",
      [number, input.customerId, date, input.note?.trim() ?? ''],
    );
    writeLines(ctx, id, input.lines);
    return id;
  });
}

/** Only drafts can be edited: once goods have left the shelf the order is a record, not a plan. */
export function updateSalesOrder(ctx: Ctx, id: number, input: SalesOrderInput): void {
  const order = getSalesOrder(ctx, id);
  if (order.status !== 'draft') throw new DomainError('wrong_status', { what: 'order', status: order.status });
  requireCustomer(ctx, input.customerId);
  const date = requireDate(input.date ?? order.order_date);
  ctx.db.transaction(() => {
    ctx.db.run('UPDATE sales_orders SET customer_id = ?, order_date = ?, note = ? WHERE id = ?', [
      input.customerId, date, input.note?.trim() ?? '', id,
    ]);
    ctx.db.run('DELETE FROM sales_order_lines WHERE order_id = ?', [id]);
    writeLines(ctx, id, input.lines);
  });
}

export function deleteSalesOrder(ctx: Ctx, id: number): void {
  const order = getSalesOrder(ctx, id);
  if (order.status !== 'draft') throw new DomainError('wrong_status', { what: 'order', status: order.status });
  ctx.db.run('DELETE FROM sales_orders WHERE id = ?', [id]);
}

export interface Shortage {
  productId: number;
  product: string;
  requested: number;
  available: number;
}

/** Which lines of this order cannot be delivered from the stock currently on hand (lines of one product are added together). */
export function checkAvailability(ctx: Ctx, orderId: number): Shortage[] {
  const order = getSalesOrder(ctx, orderId);
  const wanted = new Map<number, { product: string; qty: number }>();
  for (const line of order.lines) {
    const entry = wanted.get(line.product_id) ?? { product: line.product_name, qty: 0 };
    entry.qty += line.qty;
    wanted.set(line.product_id, entry);
  }
  const shortages: Shortage[] = [];
  for (const [productId, entry] of wanted) {
    const available = getProduct(ctx, productId).on_hand;
    if (entry.qty > available) shortages.push({ productId, product: entry.product, requested: entry.qty, available });
  }
  return shortages;
}

/**
 * Confirming an order delivers the goods: one negative stock move per line, priced at the current
 * average cost, and that cost is frozen on the line (so profit reports do not change later).
 * It is all-or-nothing: if any product is short, nothing at all is written.
 */
export function confirmSalesOrder(ctx: Ctx, id: number, date?: string): void {
  const order = getSalesOrder(ctx, id);
  if (order.status !== 'draft') throw new DomainError('wrong_status', { what: 'order', status: order.status });
  const moveDate = requireDate(date ?? ctx.today());
  const [first] = checkAvailability(ctx, id);
  if (first) {
    throw new DomainError('insufficient_stock', { product: first.product, requested: first.requested, available: first.available });
  }
  ctx.db.transaction(() => {
    for (const line of order.lines) {
      const cost = getProduct(ctx, line.product_id).cost_cents;
      ctx.db.run('UPDATE sales_order_lines SET unit_cost_cents = ? WHERE id = ?', [cost, line.id]);
      addMove(ctx, { productId: line.product_id, qty: -line.qty, kind: 'delivery', refType: 'sales_order', refId: id, unitCost: cost, date: moveDate });
    }
    ctx.db.run("UPDATE sales_orders SET status = 'confirmed' WHERE id = ?", [id]);
  });
}

/** Cancelling a confirmed order puts the goods back on the shelf. An order with a live invoice must have the invoice voided first. */
export function cancelSalesOrder(ctx: Ctx, id: number, date?: string): void {
  const order = getSalesOrder(ctx, id);
  if (order.status === 'cancelled') throw new DomainError('wrong_status', { what: 'order', status: order.status });
  if (order.invoice && order.invoice.status !== 'void') throw new DomainError('already_invoiced');
  const moveDate = requireDate(date ?? ctx.today());
  ctx.db.transaction(() => {
    if (order.status === 'confirmed') {
      for (const line of order.lines) {
        addMove(ctx, { productId: line.product_id, qty: line.qty, kind: 'return', refType: 'sales_order', refId: id, unitCost: line.unit_cost_cents, date: moveDate });
      }
    }
    ctx.db.run("UPDATE sales_orders SET status = 'cancelled' WHERE id = ?", [id]);
  });
}

/* ------------------------------------------------------------------ reading orders */

interface OrderRow {
  id: number;
  number: string;
  customer_id: number;
  customer_name: string;
  status: SalesStatus;
  order_date: string;
  note: string;
}

const ORDER_SELECT = `SELECT o.*, c.name AS customer_name FROM sales_orders o JOIN contacts c ON c.id = o.customer_id`;

function hydrate(ctx: Ctx, row: OrderRow): SalesOrder {
  const lines = loadLines(ctx, row.id);
  return { ...row, lines, totals: sumAmounts(lines.map((l) => l.amounts)), invoice: latestInvoiceSummary(ctx, row.id) };
}

export function getSalesOrder(ctx: Ctx, id: number): SalesOrder {
  const row = ctx.db.get<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
  if (!row) throw new DomainError('not_found', { what: 'order', id });
  return hydrate(ctx, row);
}

export function listSalesOrders(ctx: Ctx): SalesOrder[] {
  return ctx.db.all<OrderRow>(`${ORDER_SELECT} ORDER BY o.order_date DESC, o.id DESC`).map((row) => hydrate(ctx, row));
}

/* ------------------------------------------------------------------ invoices */

export interface Payment {
  id: number;
  invoice_id: number;
  amount_cents: number;
  method: string;
  paid_date: string;
  note: string;
}

export interface Invoice {
  id: number;
  number: string;
  order_id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  issue_date: string;
  due_date: string;
  stored_status: 'open' | 'void';
  status: InvoiceStatus;
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  days_overdue: number;
}

/**
 * The status of an invoice is never stored: it is worked out from the payments and today's date.
 * A stored "paid" flag could disagree with the payments; this cannot.
 */
export function deriveInvoiceStatus(stored: 'open' | 'void', total: number, paid: number, dueDate: string, today: string): InvoiceStatus {
  if (stored === 'void') return 'void';
  if (paid >= total) return 'paid';
  if (dueDate < today) return 'overdue';
  return paid > 0 ? 'partial' : 'unpaid';
}

interface InvoiceRow {
  id: number;
  number: string;
  order_id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  issue_date: string;
  due_date: string;
  stored_status: 'open' | 'void';
  net_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
}

const INVOICE_SELECT = `
  SELECT i.id, i.number, i.order_id, o.number AS order_number, i.customer_id, c.name AS customer_name,
         i.issue_date, i.due_date, i.status AS stored_status, i.net_cents, i.tax_cents, i.total_cents,
         COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
    FROM invoices i
    JOIN sales_orders o ON o.id = i.order_id
    JOIN contacts c ON c.id = i.customer_id`;

function toInvoice(ctx: Ctx, row: InvoiceRow): Invoice {
  const today = ctx.today();
  const status = deriveInvoiceStatus(row.stored_status, row.total_cents, row.paid_cents, row.due_date, today);
  return {
    ...row,
    status,
    balance_cents: row.stored_status === 'void' ? 0 : row.total_cents - row.paid_cents,
    days_overdue: status === 'overdue' ? diffDays(row.due_date, today) : 0,
  };
}

function latestInvoiceSummary(ctx: Ctx, orderId: number): InvoiceSummary | null {
  const row = ctx.db.get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.order_id = ? ORDER BY i.id DESC LIMIT 1`, [orderId]);
  if (!row) return null;
  const invoice = toInvoice(ctx, row);
  return { id: invoice.id, number: invoice.number, status: invoice.status, total_cents: invoice.total_cents, balance_cents: invoice.balance_cents };
}

export function getInvoice(ctx: Ctx, id: number): Invoice {
  const row = ctx.db.get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [id]);
  if (!row) throw new DomainError('not_found', { what: 'invoice', id });
  return toInvoice(ctx, row);
}

export function listInvoices(ctx: Ctx): Invoice[] {
  return ctx.db.all<InvoiceRow>(`${INVOICE_SELECT} ORDER BY i.issue_date DESC, i.id DESC`).map((row) => toInvoice(ctx, row));
}

export function listPayments(ctx: Ctx, invoiceId: number): Payment[] {
  return ctx.db.all<Payment>('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_date, id', [invoiceId]);
}

export function allPayments(ctx: Ctx): (Payment & { invoice_number: string; customer_name: string })[] {
  return ctx.db.all(
    `SELECT p.*, i.number AS invoice_number, c.name AS customer_name
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN contacts c ON c.id = i.customer_id
      ORDER BY p.paid_date DESC, p.id DESC`,
  );
}

/** Invoice a delivered order. The totals are copied onto the invoice and never recalculated. */
export function createInvoice(ctx: Ctx, orderId: number, options: { issueDate?: string; termsDays?: number } = {}): number {
  const order = getSalesOrder(ctx, orderId);
  if (order.status !== 'confirmed') throw new DomainError('wrong_status', { what: 'order', status: order.status });
  if (order.invoice && order.invoice.status !== 'void') throw new DomainError('already_invoiced');
  const issue = requireDate(options.issueDate ?? ctx.today());
  const terms = options.termsDays ?? Number(getSetting(ctx, 'payment_terms_days', '30'));
  if (!Number.isSafeInteger(terms) || terms < 0) throw new DomainError('invalid_quantity');
  return ctx.db.transaction(() =>
    ctx.db.run(
      `INSERT INTO invoices (number, order_id, customer_id, issue_date, due_date, status, net_cents, tax_cents, total_cents)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [nextNumber(ctx, 'INV', issue), orderId, order.customer_id, issue, addDays(issue, terms), order.totals.net, order.totals.tax, order.totals.gross],
    ),
  );
}

/** An invoice with money against it cannot be voided: refund or correct the payments first. */
export function voidInvoice(ctx: Ctx, id: number): void {
  const invoice = getInvoice(ctx, id);
  if (invoice.stored_status === 'void') throw new DomainError('wrong_status', { what: 'invoice', status: 'void' });
  if (invoice.paid_cents > 0) throw new DomainError('has_payments');
  ctx.db.run("UPDATE invoices SET status = 'void' WHERE id = ?", [id]);
}

export interface PaymentInput {
  amountCents: number;
  method?: string;
  date?: string;
  note?: string;
}

export function recordPayment(ctx: Ctx, invoiceId: number, input: PaymentInput): number {
  const invoice = getInvoice(ctx, invoiceId);
  if (invoice.stored_status === 'void') throw new DomainError('wrong_status', { what: 'invoice', status: 'void' });
  const amount = requireCents(input.amountCents, 'payment', { allowZero: false });
  if (amount > invoice.balance_cents) {
    throw new DomainError('overpayment', { balance: invoice.balance_cents, amount });
  }
  const date = requireDate(input.date ?? ctx.today());
  return ctx.db.run('INSERT INTO payments (invoice_id, amount_cents, method, paid_date, note) VALUES (?, ?, ?, ?, ?)', [
    invoiceId, amount, input.method?.trim() || 'cash', date, input.note?.trim() ?? '',
  ]);
}
