import { Ctx, nextNumber, requireDate } from './context';
import { DomainError } from './errors';
import { requireCents, requireQuantity } from './money';
import { getContact } from './contacts';
import { getProduct } from './products';
import { receiveIntoStock } from './stock';

export type PurchaseStatus = 'draft' | 'ordered' | 'received' | 'cancelled';

export interface PurchaseLine {
  id: number;
  order_id: number;
  product_id: number;
  qty: number;
  unit_cost_cents: number;
  sku: string;
  product_name: string;
  total_cents: number;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  supplier_id: number;
  supplier_name: string;
  status: PurchaseStatus;
  order_date: string;
  received_date: string | null;
  note: string;
  lines: PurchaseLine[];
  total_cents: number;
}

export interface PurchaseLineInput {
  productId: number;
  qty: number;
  /** Leave out to use the product's current average cost as the starting point. */
  unitCostCents?: number;
}

export interface PurchaseOrderInput {
  supplierId: number;
  date?: string;
  note?: string;
  lines: PurchaseLineInput[];
}

function writeLines(ctx: Ctx, orderId: number, lines: PurchaseLineInput[]): void {
  if (lines.length === 0) throw new DomainError('no_lines');
  for (const line of lines) {
    requireQuantity(line.qty);
    const product = getProduct(ctx, line.productId);
    const cost = line.unitCostCents === undefined ? product.cost_cents : requireCents(line.unitCostCents, 'cost');
    ctx.db.run('INSERT INTO purchase_order_lines (order_id, product_id, qty, unit_cost_cents) VALUES (?, ?, ?, ?)', [
      orderId, line.productId, line.qty, cost,
    ]);
  }
}

function requireSupplier(ctx: Ctx, id: number): void {
  if (getContact(ctx, id).kind !== 'supplier') throw new DomainError('not_found', { what: 'supplier', id });
}

export function createPurchaseOrder(ctx: Ctx, input: PurchaseOrderInput): number {
  requireSupplier(ctx, input.supplierId);
  const date = requireDate(input.date ?? ctx.today());
  return ctx.db.transaction(() => {
    const id = ctx.db.run(
      "INSERT INTO purchase_orders (number, supplier_id, status, order_date, note) VALUES (?, ?, 'draft', ?, ?)",
      [nextNumber(ctx, 'PO', date), input.supplierId, date, input.note?.trim() ?? ''],
    );
    writeLines(ctx, id, input.lines);
    return id;
  });
}

export function updatePurchaseOrder(ctx: Ctx, id: number, input: PurchaseOrderInput): void {
  const order = getPurchaseOrder(ctx, id);
  if (order.status !== 'draft') throw new DomainError('wrong_status', { what: 'purchase', status: order.status });
  requireSupplier(ctx, input.supplierId);
  const date = requireDate(input.date ?? order.order_date);
  ctx.db.transaction(() => {
    ctx.db.run('UPDATE purchase_orders SET supplier_id = ?, order_date = ?, note = ? WHERE id = ?', [
      input.supplierId, date, input.note?.trim() ?? '', id,
    ]);
    ctx.db.run('DELETE FROM purchase_order_lines WHERE order_id = ?', [id]);
    writeLines(ctx, id, input.lines);
  });
}

export function deletePurchaseOrder(ctx: Ctx, id: number): void {
  const order = getPurchaseOrder(ctx, id);
  if (order.status !== 'draft') throw new DomainError('wrong_status', { what: 'purchase', status: order.status });
  ctx.db.run('DELETE FROM purchase_orders WHERE id = ?', [id]);
}

/** draft -> ordered: the order has been sent to the supplier. Stock does not change yet. */
export function placePurchaseOrder(ctx: Ctx, id: number): void {
  const order = getPurchaseOrder(ctx, id);
  if (order.status !== 'draft') throw new DomainError('wrong_status', { what: 'purchase', status: order.status });
  ctx.db.run("UPDATE purchase_orders SET status = 'ordered' WHERE id = ?", [id]);
}

/** ordered -> received: all lines arrive at once, stock goes up and each product's average cost is updated. */
export function receivePurchaseOrder(ctx: Ctx, id: number, date?: string): void {
  const order = getPurchaseOrder(ctx, id);
  if (order.status !== 'ordered') throw new DomainError('wrong_status', { what: 'purchase', status: order.status });
  const received = requireDate(date ?? ctx.today());
  ctx.db.transaction(() => {
    for (const line of order.lines) {
      receiveIntoStock(ctx, line.product_id, line.qty, line.unit_cost_cents, 'purchase_order', id, received);
    }
    ctx.db.run("UPDATE purchase_orders SET status = 'received', received_date = ? WHERE id = ?", [received, id]);
  });
}

/** Only an order that has not arrived can be cancelled; received goods are in stock and need an adjustment instead. */
export function cancelPurchaseOrder(ctx: Ctx, id: number): void {
  const order = getPurchaseOrder(ctx, id);
  if (order.status !== 'draft' && order.status !== 'ordered') throw new DomainError('wrong_status', { what: 'purchase', status: order.status });
  ctx.db.run("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?", [id]);
}

interface OrderRow {
  id: number;
  number: string;
  supplier_id: number;
  supplier_name: string;
  status: PurchaseStatus;
  order_date: string;
  received_date: string | null;
  note: string;
}

const SELECT = 'SELECT o.*, c.name AS supplier_name FROM purchase_orders o JOIN contacts c ON c.id = o.supplier_id';

function hydrate(ctx: Ctx, row: OrderRow): PurchaseOrder {
  const lines = ctx.db
    .all<Omit<PurchaseLine, 'total_cents'>>(
      `SELECT l.*, p.sku, p.name AS product_name FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
        WHERE l.order_id = ? ORDER BY l.id`,
      [row.id],
    )
    .map((l) => ({ ...l, total_cents: l.qty * l.unit_cost_cents }));
  return { ...row, lines, total_cents: lines.reduce((sum, l) => sum + l.total_cents, 0) };
}

export function getPurchaseOrder(ctx: Ctx, id: number): PurchaseOrder {
  const row = ctx.db.get<OrderRow>(`${SELECT} WHERE o.id = ?`, [id]);
  if (!row) throw new DomainError('not_found', { what: 'purchase', id });
  return hydrate(ctx, row);
}

export function listPurchaseOrders(ctx: Ctx): PurchaseOrder[] {
  return ctx.db.all<OrderRow>(`${SELECT} ORDER BY o.order_date DESC, o.id DESC`).map((row) => hydrate(ctx, row));
}
