import { describe, expect, it } from 'vitest';
import { adjustStock, createProduct, DomainError, getProduct, listMoves, listProducts, lowStock, setProductActive, updateProduct } from '../src/domain';
import { newCtx } from './helpers';

const base = { sku: 'SOAP-1', name: 'Aleppo soap', price_cents: 450 };

describe('products', () => {
  it('creates a product with defaults and no stock', async () => {
    const ctx = await newCtx();
    const id = createProduct(ctx, base);
    expect(getProduct(ctx, id)).toMatchObject({ sku: 'SOAP-1', unit: 'pcs', cost_cents: 0, tax_bps: 0, on_hand: 0, active: 1 });
  });

  it('rejects bad input', async () => {
    const ctx = await newCtx();
    expect(() => createProduct(ctx, { ...base, name: '   ' })).toThrow(DomainError);
    expect(() => createProduct(ctx, { ...base, sku: 'has space' })).toThrow(/invalid_sku/);
    expect(() => createProduct(ctx, { ...base, price_cents: -1 })).toThrow(/invalid_amount/);
    expect(() => createProduct(ctx, { ...base, price_cents: 1.5 })).toThrow(/invalid_amount/);
    expect(() => createProduct(ctx, { ...base, tax_bps: 10001 })).toThrow(/invalid_amount/);
  });

  it('keeps SKUs unique regardless of letter case', async () => {
    const ctx = await newCtx();
    createProduct(ctx, base);
    expect(() => createProduct(ctx, { ...base, sku: 'soap-1' })).toThrow(/duplicate_sku/);
  });

  it('lets a product keep its own SKU on edit but not take another product\'s', async () => {
    const ctx = await newCtx();
    const a = createProduct(ctx, base);
    createProduct(ctx, { ...base, sku: 'OTHER' });
    updateProduct(ctx, a, { ...base, name: 'Renamed' });
    expect(getProduct(ctx, a).name).toBe('Renamed');
    expect(() => updateProduct(ctx, a, { ...base, sku: 'OTHER' })).toThrow(/duplicate_sku/);
  });

  it('archives instead of deleting, and hides archived products from the default list', async () => {
    const ctx = await newCtx();
    const id = createProduct(ctx, base);
    setProductActive(ctx, id, false);
    expect(listProducts(ctx)).toHaveLength(0);
    expect(listProducts(ctx, { includeInactive: true })).toHaveLength(1);
  });

  it('computes stock on hand from the ledger and refuses adjustments that would go negative', async () => {
    const ctx = await newCtx();
    const id = createProduct(ctx, base);
    adjustStock(ctx, id, 10, 'opening count');
    adjustStock(ctx, id, -4, 'broken');
    expect(getProduct(ctx, id).on_hand).toBe(6);
    expect(() => adjustStock(ctx, id, -7, 'too many')).toThrow(/negative_stock/);
    expect(() => adjustStock(ctx, id, 0, 'nothing')).toThrow(/invalid_quantity/);
    expect(() => adjustStock(ctx, id, 1, '  ')).toThrow(DomainError);
    expect(getProduct(ctx, id).on_hand).toBe(6);
    expect(listMoves(ctx, id).map((m) => m.qty)).toEqual([-4, 10]);
  });

  it('reports low stock only for products with a reorder level', async () => {
    const ctx = await newCtx();
    const a = createProduct(ctx, { ...base, reorder_level: 5 });
    const b = createProduct(ctx, { ...base, sku: 'B', reorder_level: 0 });
    adjustStock(ctx, a, 5, 'count');
    adjustStock(ctx, b, 1, 'count');
    expect(lowStock(ctx).map((p) => p.id)).toEqual([a]);
  });
});
