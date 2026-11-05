import { Ctx } from './context';
import { addDays, addMonths, monthKey } from './dates';
import { listInvoices } from './sales';
import { listProducts } from './products';

export interface Kpis {
  revenue_30d_cents: number;        // invoiced net amount in the last 30 days (today included)
  revenue_prev_30d_cents: number;   // ...and in the 30 days before that
  receivables_cents: number;        // unpaid balance on open invoices
  overdue_cents: number;
  overdue_count: number;
  stock_value_cents: number;
  low_stock_count: number;
  open_sales_orders: number;        // draft + confirmed-but-not-invoiced
  open_purchase_orders: number;     // draft + ordered
}

export function kpis(ctx: Ctx): Kpis {
  const today = ctx.today();
  const recentFrom = addDays(today, -29);
  const priorFrom = addDays(today, -59);
  const invoices = listInvoices(ctx).filter((i) => i.stored_status === 'open');
  const products = listProducts(ctx);
  const overdue = invoices.filter((i) => i.status === 'overdue');
  const count = (sql: string) => ctx.db.get<{ n: number }>(sql)?.n ?? 0;
  return {
    revenue_30d_cents: invoices.filter((i) => i.issue_date >= recentFrom && i.issue_date <= today).reduce((s, i) => s + i.net_cents, 0),
    revenue_prev_30d_cents: invoices.filter((i) => i.issue_date >= priorFrom && i.issue_date < recentFrom).reduce((s, i) => s + i.net_cents, 0),
    receivables_cents: invoices.reduce((s, i) => s + i.balance_cents, 0),
    overdue_cents: overdue.reduce((s, i) => s + i.balance_cents, 0),
    overdue_count: overdue.length,
    stock_value_cents: products.reduce((s, p) => s + p.stock_value_cents, 0),
    low_stock_count: products.filter((p) => p.reorder_level > 0 && p.on_hand <= p.reorder_level).length,
    open_sales_orders: count(
      `SELECT COUNT(*) AS n FROM sales_orders o WHERE o.status = 'draft'
          OR (o.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'open'))`,
    ),
    open_purchase_orders: count("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('draft', 'ordered')"),
  };
}

export interface MonthPoint {
  month: string;       // 'YYYY-MM'
  revenue_cents: number;
  cost_cents: number;
  profit_cents: number;
}

/** Revenue (net of tax), cost of goods sold, and gross profit for each of the last `months` months, oldest first. */
export function salesByMonth(ctx: Ctx, months = 6): MonthPoint[] {
  const today = ctx.today();
  const keys = Array.from({ length: months }, (_, i) => monthKey(addMonths(today, i - (months - 1))));
  const rows = ctx.db.all<{ month: string; revenue: number; cost: number }>(
    `SELECT substr(i.issue_date, 1, 7) AS month,
            SUM(l.qty * l.unit_price_cents) AS revenue,
            SUM(l.qty * l.unit_cost_cents) AS cost
       FROM invoices i JOIN sales_order_lines l ON l.order_id = i.order_id
      WHERE i.status = 'open'
      GROUP BY month`,
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return keys.map((month) => {
    const row = byMonth.get(month);
    const revenue = row?.revenue ?? 0;
    const cost = row?.cost ?? 0;
    return { month, revenue_cents: revenue, cost_cents: cost, profit_cents: revenue - cost };
  });
}

export interface TopProduct {
  product_id: number;
  sku: string;
  name: string;
  qty: number;
  revenue_cents: number;
  profit_cents: number;
}

export function topProducts(ctx: Ctx, limit = 5): TopProduct[] {
  return ctx.db.all<TopProduct>(
    `SELECT p.id AS product_id, p.sku, p.name,
            SUM(l.qty) AS qty,
            SUM(l.qty * l.unit_price_cents) AS revenue_cents,
            SUM(l.qty * (l.unit_price_cents - l.unit_cost_cents)) AS profit_cents
       FROM invoices i
       JOIN sales_order_lines l ON l.order_id = i.order_id
       JOIN products p ON p.id = l.product_id
      WHERE i.status = 'open'
      GROUP BY p.id
      ORDER BY revenue_cents DESC, p.name
      LIMIT ${Math.max(1, Math.floor(limit))}`,
  );
}

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  balance_cents: number;
}

/** What customers owe, grouped by how many days past the due date it is. */
export function receivablesAging(ctx: Ctx): AgingRow[] {
  const rows: AgingRow[] = (['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const).map((bucket) => ({ bucket, count: 0, balance_cents: 0 }));
  for (const invoice of listInvoices(ctx)) {
    if (invoice.stored_status === 'void' || invoice.balance_cents <= 0) continue;
    const d = invoice.days_overdue;
    const bucket: AgingBucket = d <= 0 ? 'current' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_plus';
    const row = rows.find((r) => r.bucket === bucket) as AgingRow;
    row.count += 1;
    row.balance_cents += invoice.balance_cents;
  }
  return rows;
}

export interface ValuationRow {
  product_id: number;
  sku: string;
  name: string;
  on_hand: number;
  avg_cost_cents: number;
  value_cents: number;
}

export function stockValuation(ctx: Ctx): ValuationRow[] {
  return listProducts(ctx, { includeInactive: true })
    .filter((p) => p.on_hand !== 0)
    .map((p) => ({ product_id: p.id, sku: p.sku, name: p.name, on_hand: p.on_hand, avg_cost_cents: p.cost_cents, value_cents: p.stock_value_cents }))
    .sort((a, b) => b.value_cents - a.value_cents);
}
