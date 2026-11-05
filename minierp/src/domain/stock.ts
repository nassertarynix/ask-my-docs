import { Ctx, requireDate, requireText } from './context';
import { DomainError } from './errors';
import { divRound } from './money';
import { getProduct, stockOnHand } from './products';

export type MoveKind = 'receipt' | 'delivery' | 'return' | 'adjustment';

export interface StockMove {
  id: number;
  product_id: number;
  qty: number;
  kind: MoveKind;
  ref_type: string;
  ref_id: number | null;
  unit_cost_cents: number;
  note: string;
  move_date: string;
}

export function addMove(
  ctx: Ctx,
  move: { productId: number; qty: number; kind: MoveKind; refType?: string; refId?: number; unitCost: number; note?: string; date: string },
): number {
  return ctx.db.run(
    `INSERT INTO stock_moves (product_id, qty, kind, ref_type, ref_id, unit_cost_cents, note, move_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [move.productId, move.qty, move.kind, move.refType ?? '', move.refId ?? null, move.unitCost, move.note ?? '', move.date],
  );
}

/**
 * Weighted-average costing. When goods arrive, the new average is
 * (stock x current average + received qty x received cost) / (stock + received qty), rounded to the cent.
 * Selling does not change the average; it only reduces the quantity.
 * Must be called BEFORE the receipt move is written so `stockOnHand` is still the old quantity.
 */
export function receiveIntoStock(ctx: Ctx, productId: number, qty: number, unitCost: number, refType: string, refId: number, date: string): void {
  const product = getProduct(ctx, productId);
  const before = stockOnHand(ctx, productId);
  const newAverage = before > 0 ? divRound(before * product.cost_cents + qty * unitCost, before + qty) : unitCost;
  ctx.db.run('UPDATE products SET cost_cents = ? WHERE id = ?', [newAverage, productId]);
  addMove(ctx, { productId, qty, kind: 'receipt', refType, refId, unitCost, date });
}

/** A manual correction (stock count, breakage). Stock can never be taken below zero. */
export function adjustStock(ctx: Ctx, productId: number, delta: number, note: string, date: string = ctx.today()): void {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new DomainError('invalid_quantity');
  requireDate(date);
  const product = getProduct(ctx, productId);
  if (product.on_hand + delta < 0) {
    throw new DomainError('negative_stock', { product: product.name, onHand: product.on_hand });
  }
  ctx.db.transaction(() => {
    addMove(ctx, { productId, qty: delta, kind: 'adjustment', unitCost: product.cost_cents, note: requireText(note), date });
  });
}

export function listMoves(ctx: Ctx, productId?: number, limit = 200): (StockMove & { product_name: string; sku: string })[] {
  const where = productId === undefined ? '' : 'WHERE m.product_id = ?';
  return ctx.db.all(
    `SELECT m.*, p.name AS product_name, p.sku AS sku
       FROM stock_moves m JOIN products p ON p.id = m.product_id
       ${where}
      ORDER BY m.move_date DESC, m.id DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
    productId === undefined ? [] : [productId],
  );
}
