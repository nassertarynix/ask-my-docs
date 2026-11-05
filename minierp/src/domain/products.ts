import { Ctx, requireText } from './context';
import { DomainError } from './errors';
import { requireCents, requireTaxBps } from './money';

export interface Product {
  id: number;
  sku: string;
  name: string;
  unit: string;
  price_cents: number;
  cost_cents: number;
  tax_bps: number;
  reorder_level: number;
  active: number;
  created_at: string;
}

export interface ProductWithStock extends Product {
  on_hand: number;
  stock_value_cents: number;
}

export interface ProductInput {
  sku: string;
  name: string;
  unit?: string;
  price_cents: number;
  cost_cents?: number;
  tax_bps?: number;
  reorder_level?: number;
}

function validate(input: ProductInput) {
  const sku = input.sku.trim();
  if (!sku || /\s/.test(sku)) throw new DomainError('invalid_sku');
  const reorder = input.reorder_level ?? 0;
  if (!Number.isSafeInteger(reorder) || reorder < 0) throw new DomainError('invalid_quantity');
  return {
    sku,
    name: requireText(input.name),
    unit: input.unit?.trim() || 'pcs',
    price: requireCents(input.price_cents, 'price'),
    cost: requireCents(input.cost_cents ?? 0, 'cost'),
    tax: requireTaxBps(input.tax_bps ?? 0),
    reorder,
  };
}

function skuTaken(ctx: Ctx, sku: string, exceptId?: number): boolean {
  const row = ctx.db.get<{ id: number }>('SELECT id FROM products WHERE sku = ? COLLATE NOCASE', [sku]);
  return row !== undefined && row.id !== exceptId;
}

export function createProduct(ctx: Ctx, input: ProductInput): number {
  const v = validate(input);
  if (skuTaken(ctx, v.sku)) throw new DomainError('duplicate_sku', { sku: v.sku });
  return ctx.db.run(
    `INSERT INTO products (sku, name, unit, price_cents, cost_cents, tax_bps, reorder_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.sku, v.name, v.unit, v.price, v.cost, v.tax, v.reorder, ctx.today()],
  );
}

/**
 * Editing a product never rewrites history: orders copy the price and tax rate onto their lines
 * when they are created, so changing the price here only affects future orders.
 * The average cost is not editable by hand either; purchase receipts maintain it.
 */
export function updateProduct(ctx: Ctx, id: number, input: Omit<ProductInput, 'cost_cents'>): void {
  getProduct(ctx, id);
  const v = validate(input);
  if (skuTaken(ctx, v.sku, id)) throw new DomainError('duplicate_sku', { sku: v.sku });
  ctx.db.run(
    'UPDATE products SET sku = ?, name = ?, unit = ?, price_cents = ?, tax_bps = ?, reorder_level = ? WHERE id = ?',
    [v.sku, v.name, v.unit, v.price, v.tax, v.reorder, id],
  );
}

export function setProductActive(ctx: Ctx, id: number, active: boolean): void {
  getProduct(ctx, id);
  ctx.db.run('UPDATE products SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
}

const WITH_STOCK = `
  SELECT p.*,
         COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.product_id = p.id), 0) AS on_hand,
         COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.product_id = p.id), 0) * p.cost_cents AS stock_value_cents
    FROM products p`;

export function getProduct(ctx: Ctx, id: number): ProductWithStock {
  const row = ctx.db.get<ProductWithStock>(`${WITH_STOCK} WHERE p.id = ?`, [id]);
  if (!row) throw new DomainError('not_found', { what: 'product', id });
  return row;
}

export function listProducts(ctx: Ctx, { includeInactive = false } = {}): ProductWithStock[] {
  return ctx.db.all<ProductWithStock>(
    `${WITH_STOCK} ${includeInactive ? '' : 'WHERE p.active = 1'} ORDER BY p.name COLLATE NOCASE`,
  );
}

export function stockOnHand(ctx: Ctx, productId: number): number {
  return ctx.db.get<{ n: number }>('SELECT COALESCE(SUM(qty), 0) AS n FROM stock_moves WHERE product_id = ?', [productId])?.n ?? 0;
}

/** Products at or below their reorder level (only those that have a level set). */
export function lowStock(ctx: Ctx): ProductWithStock[] {
  return listProducts(ctx).filter((p) => p.reorder_level > 0 && p.on_hand <= p.reorder_level);
}
