import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { customerBalances, receivablesAging, salesByMonth, stockValuation, topProducts } from '../../domain';
import { AgingBars, MonthBars } from '../charts';
import { Card, PageHeader } from '../components';
import { useErp } from '../erp';
import { useI18n } from '../i18n';

export function Reports() {
  const { ctx, rev } = useErp();
  const { t, money, num, percent } = useI18n();
  const data = useMemo(() => ({
    months: salesByMonth(ctx, 12),
    top: topProducts(ctx, 10),
    aging: receivablesAging(ctx),
    valuation: stockValuation(ctx),
    debtors: customerBalances(ctx).filter((c) => c.balance_cents > 0).sort((a, b) => b.balance_cents - a.balance_cents).slice(0, 8),
  }), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const revenue = data.months.reduce((s, m) => s + m.revenue_cents, 0);
  const profit = data.months.reduce((s, m) => s + m.profit_cents, 0);
  const stockTotal = data.valuation.reduce((s, r) => s + r.value_cents, 0);

  return (
    <>
      <PageHeader title={t('nav.reports')} />
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">{t('reports.revenue12')}</span><strong className="kpi-value num">{money(revenue)}</strong></div>
        <div className="kpi"><span className="kpi-label">{t('reports.profit12')}</span><strong className="kpi-value num">{money(profit)}</strong>
          <span className="kpi-note">{revenue > 0 ? t('reports.marginOf', { pct: percent(Math.round((profit / revenue) * 10_000)) }) : ''}</span></div>
      </div>
      <Card title={t('reports.byMonth')}><MonthBars points={data.months.slice(-12)} /></Card>
      <div className="grid-2">
        <Card title={t('reports.topProducts')}>
          {data.top.length === 0 ? <p className="muted">{t('dash.noSalesYet')}</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('stock.name')}</th><th className="r hide-sm">{t('reports.units')}</th><th className="r">{t('chart.revenue')}</th><th className="r">{t('chart.profit')}</th></tr></thead>
                <tbody>
                  {data.top.map((p) => (
                    <tr key={p.product_id}><td><Link to={`/stock/${p.product_id}`}>{p.name}</Link></td><td className="r num hide-sm">{num(p.qty)}</td><td className="r num">{money(p.revenue_cents)}</td><td className="r num">{money(p.profit_cents)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={t('dash.aging')}>
          <AgingBars rows={data.aging} />
          {data.debtors.length > 0 && (
            <>
              <h3 className="sub">{t('reports.whoOwes')}</h3>
              <ul className="plain-list">
                {data.debtors.map((c) => <li key={c.id}><Link to={`/contacts/${c.id}`} className="split"><span>{c.name}</span><span className="num">{money(c.balance_cents)}</span></Link></li>)}
              </ul>
            </>
          )}
        </Card>
      </div>
      <Card title={t('reports.valuation')} actions={<strong className="num">{money(stockTotal)}</strong>}>
        {data.valuation.length === 0 ? <p className="muted">{t('reports.noStock')}</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('stock.name')}</th><th className="r">{t('stock.onHand')}</th><th className="r hide-sm">{t('stock.avgCost')}</th><th className="r">{t('stock.value')}</th></tr></thead>
              <tbody>
                {data.valuation.map((r) => (
                  <tr key={r.product_id}><td><Link to={`/stock/${r.product_id}`}>{r.name}</Link></td><td className="r num">{num(r.on_hand)}</td><td className="r num hide-sm">{money(r.avg_cost_cents)}</td><td className="r num">{money(r.value_cents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
