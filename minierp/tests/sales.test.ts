import { describe, expect, it } from 'vitest';
import {
  adjustStock, cancelSalesOrder, checkAvailability, confirmSalesOrder, createContact, createInvoice, createProduct,
  createSalesOrder, deleteSalesOrder, deriveInvoiceStatus, getInvoice, getProduct, getSalesOrder, listInvoices,
  listPayments, recordPayment, updateSalesOrder, voidInvoice, setSetting, deleteContact,
} from '../src/domain';
import { newCtx, TestCtx } from './helpers';

async function world() {
  const ctx = await newCtx('2026-06-15');
  const customer = createContact(ctx, { kind: 'customer', name: 'Cafe Damascus' });
  const soap = createProduct(ctx, { sku: 'SOAP', name: 'Aleppo soap', price_cents: 1000, tax_bps: 1500 });
  const oil = createProduct(ctx, { sku: 'OIL', name: 'Olive oil', price_cents: 2500, tax_bps: 0 });
  adjustStock(ctx, soap, 10, 'opening');
  adjustStock(ctx, oil, 4, 'opening');
  return { ctx, customer, soap, oil };
}

function confirmed(ctx: TestCtx, customer: number, lines: { productId: number; qty: number }[]) {
  const id = createSalesOrder(ctx, { customerId: customer, lines });
  confirmSalesOrder(ctx, id);
  return id;
}

describe('sales orders', () => {
  it('numbers orders per year and keeps the price and tax of the moment on the line', async () => {
    const { ctx, customer, soap } = await world();
    const a = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 2 }] });
    const b = createSalesOrder(ctx, { customerId: customer, date: '2027-01-02', lines: [{ productId: soap, qty: 1 }] });
    expect(getSalesOrder(ctx, a).number).toBe('SO-2026-0001');
    expect(getSalesOrder(ctx, b).number).toBe('SO-2027-0001');
    ctx.db.run('UPDATE products SET price_cents = 9999 WHERE id = ?', [soap]);
    expect(getSalesOrder(ctx, a).lines[0]).toMatchObject({ unit_price_cents: 1000, tax_bps: 1500 });
  });

  it('totals the order with tax rounded per line', async () => {
    const { ctx, customer, soap, oil } = await world();
    const id = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 3 }, { productId: oil, qty: 1, unitPriceCents: 2000 }] });
    expect(getSalesOrder(ctx, id).totals).toEqual({ net: 5000, tax: 450, gross: 5450 });
  });

  it('needs at least one line, a real customer and positive quantities, and writes nothing when it fails', async () => {
    const { ctx, customer, soap } = await world();
    expect(() => createSalesOrder(ctx, { customerId: customer, lines: [] })).toThrow(/no_lines/);
    expect(() => createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 0 }] })).toThrow(/invalid_quantity/);
    expect(() => createSalesOrder(ctx, { customerId: 999, lines: [{ productId: soap, qty: 1 }] })).toThrow(/not_found/);
    const supplier = createContact(ctx, { kind: 'supplier', name: 'Supplier' });
    expect(() => createSalesOrder(ctx, { customerId: supplier, lines: [{ productId: soap, qty: 1 }] })).toThrow(/not_found/);
    expect(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales_orders')?.n).toBe(0);
    // a failed attempt must not burn a document number
    expect(getSalesOrder(ctx, createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 1 }] })).number).toBe('SO-2026-0001');
  });

  it('edits and deletes only drafts', async () => {
    const { ctx, customer, soap } = await world();
    const id = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 1 }] });
    updateSalesOrder(ctx, id, { customerId: customer, lines: [{ productId: soap, qty: 5 }], note: 'changed' });
    expect(getSalesOrder(ctx, id)).toMatchObject({ note: 'changed' });
    expect(getSalesOrder(ctx, id).lines[0]?.qty).toBe(5);
    confirmSalesOrder(ctx, id);
    expect(() => updateSalesOrder(ctx, id, { customerId: customer, lines: [{ productId: soap, qty: 1 }] })).toThrow(/wrong_status/);
    expect(() => deleteSalesOrder(ctx, id)).toThrow(/wrong_status/);
    const draft = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 1 }] });
    deleteSalesOrder(ctx, draft);
    expect(() => getSalesOrder(ctx, draft)).toThrow(/not_found/);
  });
});

describe('confirming an order (delivery)', () => {
  it('takes the goods out of stock and freezes the cost on the lines', async () => {
    const { ctx, customer, soap } = await world();
    ctx.db.run('UPDATE products SET cost_cents = 400 WHERE id = ?', [soap]);
    const id = confirmed(ctx, customer, [{ productId: soap, qty: 4 }]);
    expect(getProduct(ctx, soap).on_hand).toBe(6);
    expect(getSalesOrder(ctx, id)).toMatchObject({ status: 'confirmed' });
    expect(getSalesOrder(ctx, id).lines[0]?.unit_cost_cents).toBe(400);
    ctx.db.run('UPDATE products SET cost_cents = 700 WHERE id = ?', [soap]);
    expect(getSalesOrder(ctx, id).lines[0]?.unit_cost_cents).toBe(400);
  });

  it('refuses when stock is short and leaves stock untouched (all or nothing)', async () => {
    const { ctx, customer, soap, oil } = await world();
    const id = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 3 }, { productId: oil, qty: 5 }] });
    expect(() => confirmSalesOrder(ctx, id)).toThrow(/insufficient_stock/);
    expect(getProduct(ctx, soap).on_hand).toBe(10);
    expect(getProduct(ctx, oil).on_hand).toBe(4);
    expect(getSalesOrder(ctx, id).status).toBe('draft');
    expect(checkAvailability(ctx, id)).toEqual([{ productId: oil, product: 'Olive oil', requested: 5, available: 4 }]);
  });

  it('adds up several lines of the same product when checking stock', async () => {
    const { ctx, customer, oil } = await world();
    const id = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: oil, qty: 3 }, { productId: oil, qty: 3 }] });
    expect(checkAvailability(ctx, id)[0]).toMatchObject({ requested: 6, available: 4 });
    expect(() => confirmSalesOrder(ctx, id)).toThrow(/insufficient_stock/);
  });

  it('cannot be confirmed twice (which would deliver twice)', async () => {
    const { ctx, customer, soap } = await world();
    const id = confirmed(ctx, customer, [{ productId: soap, qty: 1 }]);
    expect(() => confirmSalesOrder(ctx, id)).toThrow(/wrong_status/);
    expect(getProduct(ctx, soap).on_hand).toBe(9);
  });

  it('puts the goods back when a confirmed order is cancelled', async () => {
    const { ctx, customer, soap } = await world();
    const id = confirmed(ctx, customer, [{ productId: soap, qty: 4 }]);
    cancelSalesOrder(ctx, id);
    expect(getProduct(ctx, soap).on_hand).toBe(10);
    expect(getSalesOrder(ctx, id).status).toBe('cancelled');
    expect(() => cancelSalesOrder(ctx, id)).toThrow(/wrong_status/);
  });

  it('cancelling a draft changes no stock', async () => {
    const { ctx, customer, soap } = await world();
    const id = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 4 }] });
    cancelSalesOrder(ctx, id);
    expect(getProduct(ctx, soap).on_hand).toBe(10);
  });
});

describe('invoices and payments', () => {
  it('invoices a confirmed order with the total copied from it, due after the payment terms', async () => {
    const { ctx, customer, soap } = await world();
    const order = confirmed(ctx, customer, [{ productId: soap, qty: 2 }]);
    const id = createInvoice(ctx, order);
    expect(getInvoice(ctx, id)).toMatchObject({
      number: 'INV-2026-0001', issue_date: '2026-06-15', due_date: '2026-07-15',
      net_cents: 2000, tax_cents: 300, total_cents: 2300, balance_cents: 2300, status: 'unpaid',
    });
  });

  it('uses the payment terms from settings', async () => {
    const { ctx, customer, soap } = await world();
    setSetting(ctx, 'payment_terms_days', '7');
    const id = createInvoice(ctx, confirmed(ctx, customer, [{ productId: soap, qty: 1 }]));
    expect(getInvoice(ctx, id).due_date).toBe('2026-06-22');
  });

  it('refuses to invoice a draft, a cancelled order, or an order twice', async () => {
    const { ctx, customer, soap } = await world();
    const draft = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 1 }] });
    expect(() => createInvoice(ctx, draft)).toThrow(/wrong_status/);
    const order = confirmed(ctx, customer, [{ productId: soap, qty: 1 }]);
    createInvoice(ctx, order);
    expect(() => createInvoice(ctx, order)).toThrow(/already_invoiced/);
  });

  it('records part payments and moves from unpaid to partial to paid', async () => {
    const { ctx, customer, soap } = await world();
    const id = createInvoice(ctx, confirmed(ctx, customer, [{ productId: soap, qty: 2 }])); // 2300
    recordPayment(ctx, id, { amountCents: 1000, method: 'bank' });
    expect(getInvoice(ctx, id)).toMatchObject({ status: 'partial', paid_cents: 1000, balance_cents: 1300 });
    recordPayment(ctx, id, { amountCents: 1300 });
    expect(getInvoice(ctx, id)).toMatchObject({ status: 'paid', balance_cents: 0 });
    expect(listPayments(ctx, id)).toHaveLength(2);
  });

  it('refuses overpayment, zero payments and payments on void invoices', async () => {
    const { ctx, customer, soap } = await world();
    const id = createInvoice(ctx, confirmed(ctx, customer, [{ productId: soap, qty: 1 }])); // 1150
    expect(() => recordPayment(ctx, id, { amountCents: 1151 })).toThrow(/overpayment/);
    expect(() => recordPayment(ctx, id, { amountCents: 0 })).toThrow(/invalid_amount/);
    expect(listPayments(ctx, id)).toHaveLength(0);
    voidInvoice(ctx, id);
    expect(() => recordPayment(ctx, id, { amountCents: 100 })).toThrow(/wrong_status/);
  });

  it('turns overdue when the due date passes, and back to partial/unpaid logic is derived, never stored', async () => {
    const { ctx, customer, soap } = await world();
    const id = createInvoice(ctx, confirmed(ctx, customer, [{ productId: soap, qty: 1 }]));
    expect(getInvoice(ctx, id).status).toBe('unpaid');
    ctx.setToday('2026-07-15');
    expect(getInvoice(ctx, id).status).toBe('unpaid'); // due today is not late yet
    ctx.setToday('2026-07-16');
    expect(getInvoice(ctx, id)).toMatchObject({ status: 'overdue', days_overdue: 1 });
    recordPayment(ctx, id, { amountCents: 1150 });
    expect(getInvoice(ctx, id).status).toBe('paid');
  });

  it('derives statuses from first principles', () => {
    expect(deriveInvoiceStatus('open', 100, 0, '2026-01-10', '2026-01-10')).toBe('unpaid');
    expect(deriveInvoiceStatus('open', 100, 40, '2026-01-10', '2026-01-10')).toBe('partial');
    expect(deriveInvoiceStatus('open', 100, 40, '2026-01-09', '2026-01-10')).toBe('overdue');
    expect(deriveInvoiceStatus('open', 100, 100, '2026-01-01', '2026-01-10')).toBe('paid');
    expect(deriveInvoiceStatus('void', 100, 0, '2026-01-01', '2026-01-10')).toBe('void');
  });

  it('cannot void an invoice that has payments, but can void an unpaid one and invoice the order again', async () => {
    const { ctx, customer, soap } = await world();
    const order = confirmed(ctx, customer, [{ productId: soap, qty: 1 }]);
    const first = createInvoice(ctx, order);
    recordPayment(ctx, first, { amountCents: 100 });
    expect(() => voidInvoice(ctx, first)).toThrow(/has_payments/);

    const order2 = confirmed(ctx, customer, [{ productId: soap, qty: 1 }]);
    const second = createInvoice(ctx, order2);
    voidInvoice(ctx, second);
    expect(getInvoice(ctx, second)).toMatchObject({ status: 'void', balance_cents: 0 });
    const third = createInvoice(ctx, order2);
    expect(getInvoice(ctx, third).number).toBe('INV-2026-0003');
    expect(listInvoices(ctx)).toHaveLength(3);
  });

  it('will not cancel an order that has a live invoice, but will once the invoice is void', async () => {
    const { ctx, customer, soap } = await world();
    const order = confirmed(ctx, customer, [{ productId: soap, qty: 2 }]);
    const invoice = createInvoice(ctx, order);
    expect(() => cancelSalesOrder(ctx, order)).toThrow(/already_invoiced/);
    expect(getProduct(ctx, soap).on_hand).toBe(8);
    voidInvoice(ctx, invoice);
    cancelSalesOrder(ctx, order);
    expect(getProduct(ctx, soap).on_hand).toBe(10);
  });

  it('keeps a customer that has orders', async () => {
    const { ctx, customer, soap } = await world();
    createSalesOrder(ctx, { customerId: customer, lines: [{ productId: soap, qty: 1 }] });
    expect(() => deleteContact(ctx, customer)).toThrow(/in_use/);
    const other = createContact(ctx, { kind: 'customer', name: 'Nobody' });
    deleteContact(ctx, other);
  });
});
