import { describe, expect, it } from 'vitest';
import {
  adjustStock, cancelPurchaseOrder, createContact, createProduct, createPurchaseOrder, deletePurchaseOrder, getProduct,
  getPurchaseOrder, listMoves, placePurchaseOrder, receivePurchaseOrder, updatePurchaseOrder, createSalesOrder, confirmSalesOrder,
} from '../src/domain';
import { newCtx } from './helpers';

async function world() {
  const ctx = await newCtx('2026-06-15');
  const supplier = createContact(ctx, { kind: 'supplier', name: 'Idlib Farms' });
  const customer = createContact(ctx, { kind: 'customer', name: 'Customer' });
  const oil = createProduct(ctx, { sku: 'OIL', name: 'Olive oil', price_cents: 2500 });
  return { ctx, supplier, customer, oil };
}

describe('purchase orders', () => {
  it('goes draft -> ordered -> received, and only receiving changes stock', async () => {
    const { ctx, supplier, oil } = await world();
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 10, unitCostCents: 1000 }] });
    expect(getPurchaseOrder(ctx, id)).toMatchObject({ status: 'draft', number: 'PO-2026-0001', total_cents: 10000 });
    placePurchaseOrder(ctx, id);
    expect(getProduct(ctx, oil).on_hand).toBe(0);
    receivePurchaseOrder(ctx, id, '2026-06-20');
    expect(getProduct(ctx, oil).on_hand).toBe(10);
    expect(getPurchaseOrder(ctx, id)).toMatchObject({ status: 'received', received_date: '2026-06-20' });
  });

  it('cannot receive a draft, or receive twice (which would double the stock)', async () => {
    const { ctx, supplier, oil } = await world();
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 5, unitCostCents: 1000 }] });
    expect(() => receivePurchaseOrder(ctx, id)).toThrow(/wrong_status/);
    placePurchaseOrder(ctx, id);
    receivePurchaseOrder(ctx, id);
    expect(() => receivePurchaseOrder(ctx, id)).toThrow(/wrong_status/);
    expect(getProduct(ctx, oil).on_hand).toBe(5);
  });

  it('sets the average cost to the first purchase price', async () => {
    const { ctx, supplier, oil } = await world();
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 10, unitCostCents: 1000 }] });
    placePurchaseOrder(ctx, id);
    receivePurchaseOrder(ctx, id);
    expect(getProduct(ctx, oil).cost_cents).toBe(1000);
  });

  it('keeps a weighted average cost across purchases', async () => {
    const { ctx, supplier, oil } = await world();
    for (const [qty, cost] of [[10, 1000], [30, 1200]] as const) {
      const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty, unitCostCents: cost }] });
      placePurchaseOrder(ctx, id);
      receivePurchaseOrder(ctx, id);
    }
    // (10 x 10.00 + 30 x 12.00) / 40 = 11.50
    expect(getProduct(ctx, oil)).toMatchObject({ on_hand: 40, cost_cents: 1150, stock_value_cents: 46000 });
  });

  it('does not let a sale change the average, and weights only the stock that is still there', async () => {
    const { ctx, supplier, customer, oil } = await world();
    const buy = (qty: number, cost: number) => {
      const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty, unitCostCents: cost }] });
      placePurchaseOrder(ctx, id);
      receivePurchaseOrder(ctx, id);
    };
    buy(10, 1000);
    const sale = createSalesOrder(ctx, { customerId: customer, lines: [{ productId: oil, qty: 6 }] });
    confirmSalesOrder(ctx, sale);
    expect(getProduct(ctx, oil).cost_cents).toBe(1000);
    buy(6, 1300); // 4 left at 10.00 + 6 at 13.00 -> (4000 + 7800) / 10 = 11.80
    expect(getProduct(ctx, oil)).toMatchObject({ on_hand: 10, cost_cents: 1180 });
  });

  it('starts a fresh average when the shelf is empty, ignoring the old cost', async () => {
    const { ctx, supplier, oil } = await world();
    adjustStock(ctx, oil, 3, 'count');
    ctx.db.run('UPDATE products SET cost_cents = 5000 WHERE id = ?', [oil]);
    adjustStock(ctx, oil, -3, 'written off');
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 2, unitCostCents: 800 }] });
    placePurchaseOrder(ctx, id);
    receivePurchaseOrder(ctx, id);
    expect(getProduct(ctx, oil).cost_cents).toBe(800);
  });

  it('records one receipt move per line, with the date and the cost it was bought at', async () => {
    const { ctx, supplier, oil } = await world();
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 7, unitCostCents: 900 }] });
    placePurchaseOrder(ctx, id);
    receivePurchaseOrder(ctx, id, '2026-06-18');
    expect(listMoves(ctx, oil)[0]).toMatchObject({ kind: 'receipt', qty: 7, unit_cost_cents: 900, move_date: '2026-06-18', ref_type: 'purchase_order', ref_id: id });
  });

  it('edits and deletes drafts only, and cancels anything not yet received', async () => {
    const { ctx, supplier, oil } = await world();
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 5, unitCostCents: 900 }] });
    updatePurchaseOrder(ctx, id, { supplierId: supplier, lines: [{ productId: oil, qty: 8, unitCostCents: 950 }] });
    expect(getPurchaseOrder(ctx, id).total_cents).toBe(7600);
    placePurchaseOrder(ctx, id);
    expect(() => updatePurchaseOrder(ctx, id, { supplierId: supplier, lines: [{ productId: oil, qty: 1 }] })).toThrow(/wrong_status/);
    expect(() => deletePurchaseOrder(ctx, id)).toThrow(/wrong_status/);
    cancelPurchaseOrder(ctx, id);
    expect(getPurchaseOrder(ctx, id).status).toBe('cancelled');
    expect(getProduct(ctx, oil).on_hand).toBe(0);
  });

  it('cannot cancel an order that has already been received', async () => {
    const { ctx, supplier, oil } = await world();
    const id = createPurchaseOrder(ctx, { supplierId: supplier, lines: [{ productId: oil, qty: 5, unitCostCents: 900 }] });
    placePurchaseOrder(ctx, id);
    receivePurchaseOrder(ctx, id);
    expect(() => cancelPurchaseOrder(ctx, id)).toThrow(/wrong_status/);
  });

  it('only accepts a supplier, and needs lines', async () => {
    const { ctx, customer, supplier, oil } = await world();
    expect(() => createPurchaseOrder(ctx, { supplierId: customer, lines: [{ productId: oil, qty: 1 }] })).toThrow(/not_found/);
    expect(() => createPurchaseOrder(ctx, { supplierId: supplier, lines: [] })).toThrow(/no_lines/);
  });
});
