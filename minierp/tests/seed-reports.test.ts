import { describe, expect, it } from 'vitest';
import {
  getSetting, kpis, listInvoices, listMoves, listProducts, lowStock, receivablesAging, salesByMonth, seedDemoData,
  stockValuation, topProducts, allPayments, customerBalances, listSalesOrders, listPurchaseOrders,
} from '../src/domain';
import { newCtx } from './helpers';

async function seeded(today = '2026-11-05') {
  const ctx = await newCtx(today);
  seedDemoData(ctx, today);
  return ctx;
}

describe('demo data', () => {
  it('builds a believable business', async () => {
    const ctx = await seeded();
    expect(getSetting(ctx, 'business_name', '')).toBe('Levant Pantry Co.');
    expect(listProducts(ctx)).toHaveLength(12);
    expect(listInvoices(ctx).length).toBeGreaterThan(60);
    expect(listSalesOrders(ctx).some((o) => o.status === 'draft')).toBe(true);
    expect(listPurchaseOrders(ctx).some((o) => o.status === 'ordered')).toBe(true);
  });

  it('is deterministic: the same date always gives the same business', async () => {
    const a = await seeded();
    const b = await seeded();
    expect(kpis(a)).toEqual(kpis(b));
    expect(listInvoices(a).map((i) => i.total_cents)).toEqual(listInvoices(b).map((i) => i.total_cents));
  });

  it('never breaks the books: stock >= 0, payments <= totals, ledger matches deliveries', async () => {
    const ctx = await seeded();
    expect(listProducts(ctx, { includeInactive: true }).every((p) => p.on_hand >= 0)).toBe(true);
    for (const invoice of listInvoices(ctx)) {
      expect(invoice.paid_cents).toBeLessThanOrEqual(invoice.total_cents);
      expect(invoice.net_cents + invoice.tax_cents).toBe(invoice.total_cents);
    }
    // every delivered unit on a confirmed order appears exactly once in the stock ledger
    for (const order of listSalesOrders(ctx).filter((o) => o.status === 'confirmed')) {
      const delivered = listMoves(ctx, undefined, 100000).filter((m) => m.ref_type === 'sales_order' && m.ref_id === order.id && m.kind === 'delivery');
      expect(delivered.reduce((s, m) => s - m.qty, 0)).toBe(order.lines.reduce((s, l) => s + l.qty, 0));
    }
    // no payment is dated in the future
    expect(allPayments(ctx).every((p) => p.paid_date <= '2026-11-05')).toBe(true);
  });

  it('leaves things to act on: overdue invoices and low stock', async () => {
    const ctx = await seeded();
    expect(kpis(ctx).overdue_count).toBeGreaterThan(0);
    expect(lowStock(ctx).length).toBeGreaterThanOrEqual(3);
  });
});

describe('reports', () => {
  it('reports the KPIs consistently with the underlying lists', async () => {
    const ctx = await seeded();
    const k = kpis(ctx);
    const open = listInvoices(ctx).filter((i) => i.stored_status === 'open');
    expect(k.receivables_cents).toBe(open.reduce((s, i) => s + i.balance_cents, 0));
    expect(k.overdue_cents).toBe(open.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.balance_cents, 0));
    expect(k.stock_value_cents).toBe(stockValuation(ctx).reduce((s, r) => s + r.value_cents, 0));
    expect(k.low_stock_count).toBe(lowStock(ctx).length);
  });

  it('splits revenue by month, oldest first, and the months add up to the invoiced net', async () => {
    const ctx = await seeded();
    const months = salesByMonth(ctx, 12);
    expect(months).toHaveLength(12);
    expect(months[11]?.month).toBe('2026-11');
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
    // a year of history spans 13 calendar months, so only count invoices inside the 12-month window
    const first = months[0]?.month as string;
    const invoicedNet = listInvoices(ctx).filter((i) => i.stored_status === 'open' && i.issue_date.slice(0, 7) >= first).reduce((s, i) => s + i.net_cents, 0);
    expect(months.reduce((s, m) => s + m.revenue_cents, 0)).toBe(invoicedNet);
    for (const m of months) expect(m.profit_cents).toBe(m.revenue_cents - m.cost_cents);
  });

  it('ranks products by revenue', async () => {
    const ctx = await seeded();
    const top = topProducts(ctx, 5);
    expect(top).toHaveLength(5);
    for (let i = 1; i < top.length; i += 1) expect((top[i - 1] as { revenue_cents: number }).revenue_cents).toBeGreaterThanOrEqual((top[i] as { revenue_cents: number }).revenue_cents);
  });

  it('buckets receivables by days past due and the buckets add up to the receivables', async () => {
    const ctx = await seeded();
    const aging = receivablesAging(ctx);
    expect(aging.map((r) => r.bucket)).toEqual(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
    expect(aging.reduce((s, r) => s + r.balance_cents, 0)).toBe(kpis(ctx).receivables_cents);
  });

  it('puts each overdue invoice in the right bucket', async () => {
    const ctx = await newCtx('2026-06-15');
    seedDemoData(ctx, '2026-06-15', 20);
    const aging = receivablesAging(ctx);
    const manual = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const i of listInvoices(ctx)) {
      if (i.balance_cents <= 0) continue;
      const d = i.days_overdue;
      manual[d <= 0 ? 'current' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_plus'] += i.balance_cents;
    }
    expect(Object.fromEntries(aging.map((r) => [r.bucket, r.balance_cents]))).toEqual(manual);
  });

  it('balances each customer: invoiced - paid = owed', async () => {
    const ctx = await seeded();
    for (const c of customerBalances(ctx)) expect(c.invoiced_cents - c.paid_cents).toBe(c.balance_cents);
    expect(customerBalances(ctx).reduce((s, c) => s + c.balance_cents, 0)).toBe(kpis(ctx).receivables_cents);
  });
});

describe('rolling revenue', () => {
  it('counts the last 30 days against the 30 before, by invoice date', async () => {
    const ctx = await newCtx('2026-06-30');
    seedDemoData(ctx, '2026-06-30', 90);
    const k = kpis(ctx);
    const net = (from: string, to: string) =>
      listInvoices(ctx).filter((i) => i.stored_status === 'open' && i.issue_date >= from && i.issue_date <= to).reduce((s, i) => s + i.net_cents, 0);
    expect(k.revenue_30d_cents).toBe(net('2026-06-01', '2026-06-30'));
    expect(k.revenue_prev_30d_cents).toBe(net('2026-05-02', '2026-05-31'));
    expect(k.revenue_30d_cents).toBeGreaterThan(0);
  });
});
