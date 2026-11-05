import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getSetting, kpis, listContacts, listInvoices, lowStock, receivablesAging, salesByMonth, topProducts } from '../../domain';
import { AgingBars, MonthBars } from '../charts';
import { Card, Empty, PageHeader } from '../components';
import { useErp } from '../erp';
import { Icon } from '../icons';
import { useI18n } from '../i18n';

export function Dashboard() {
  const { ctx, rev, loadDemo, startEmpty } = useErp();
  const { t, money, num, date } = useI18n();

  const data = useMemo(() => {
    const productsCount = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')?.n ?? 0;
    const contactsCount = listContacts(ctx).length;
    return {
      empty: productsCount === 0 && contactsCount === 0 && getSetting(ctx, 'onboarded', '') === '',
      noProducts: productsCount === 0,
      name: getSetting(ctx, 'business_name', ''),
      k: kpis(ctx),
      months: salesByMonth(ctx, 6),
      top: topProducts(ctx, 5),
      aging: receivablesAging(ctx),
      low: lowStock(ctx).slice(0, 4),
      overdue: listInvoices(ctx).filter((i) => i.status === 'overdue').sort((a, b) => b.days_overdue - a.days_overdue).slice(0, 3),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rev]);

  if (data.empty) {
    return (
      <>
        <PageHeader title={t('app.name')} />
        <Empty
          icon="home"
          title={t('welcome.title')}
          text={t('welcome.text')}
          action={
            <div className="stack">
              <button className="btn primary block" onClick={loadDemo}>{t('welcome.demo')}</button>
              <button className="btn block" onClick={startEmpty}>{t('welcome.empty')}</button>
              <small className="muted">{t('welcome.privacy')}</small>
            </div>
          }
        />
      </>
    );
  }

  const { k } = data;
  const delta = k.revenue_prev_30d_cents > 0 ? Math.round(((k.revenue_30d_cents - k.revenue_prev_30d_cents) / k.revenue_prev_30d_cents) * 100) : null;
  const attention = [
    k.overdue_count > 0 && { to: '/invoices?filter=overdue', text: t('attention.overdue', { n: num(k.overdue_count), amount: money(k.overdue_cents) }), tone: 'danger' },
    k.low_stock_count > 0 && { to: '/stock?filter=low', text: t('attention.low', { n: num(k.low_stock_count) }), tone: 'warn' },
    k.open_sales_orders > 0 && { to: '/sales?filter=open', text: t('attention.sales', { n: num(k.open_sales_orders) }), tone: 'info' },
    k.open_purchase_orders > 0 && { to: '/purchases?filter=open', text: t('attention.purchases', { n: num(k.open_purchase_orders) }), tone: 'info' },
  ].filter(Boolean) as { to: string; text: string; tone: string }[];

  return (
    <>
      <PageHeader
        title={data.name || t('app.name')}
        subtitle={date(ctx.today())}
        actions={<Link to="/sales/new" className="btn primary"><Icon name="plus" size={18} />{t('sales.new')}</Link>}
      />

      <div className="kpis">
        <Link to="/reports" className="kpi">
          <span className="kpi-label">{t('kpi.revenue30')}</span>
          <strong className="kpi-value num">{money(k.revenue_30d_cents)}</strong>
          {delta !== null && (
            <span className={`kpi-note ${delta >= 0 ? 'good' : 'bad'}`}>
              {delta >= 0 ? '▲' : '▼'} {t('kpi.vsLast', { pct: num(Math.abs(delta)) })}
            </span>
          )}
        </Link>
        <Link to="/invoices?filter=unpaid" className="kpi">
          <span className="kpi-label">{t('kpi.receivables')}</span>
          <strong className="kpi-value num">{money(k.receivables_cents)}</strong>
        </Link>
        <Link to="/invoices?filter=overdue" className={`kpi ${k.overdue_count > 0 ? 'alert' : ''}`}>
          <span className="kpi-label">{t('kpi.overdue')}</span>
          <strong className="kpi-value num">{money(k.overdue_cents)}</strong>
          <span className="kpi-note">{t('kpi.invoices', { n: num(k.overdue_count) })}</span>
        </Link>
        <Link to="/reports" className="kpi">
          <span className="kpi-label">{t('kpi.stockValue')}</span>
          <strong className="kpi-value num">{money(k.stock_value_cents)}</strong>
        </Link>
      </div>

      {data.noProducts && (
        <Card title={t('dash.start')}>
          <p className="muted">{t('dash.startText')}</p>
          <div className="actions">
            <Link className="btn primary" to="/stock">{t('stock.new')}</Link>
            <Link className="btn" to="/contacts">{t('contacts.newCustomer')}</Link>
          </div>
        </Card>
      )}

      {attention.length > 0 && (
        <Card title={t('dash.attention')}>
          <ul className="attention">
            {attention.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={`attention-item ${item.tone}`}>
                  <span>{item.text}</span>
                  <Icon name="chevron" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid-2">
        <Card title={t('dash.sales6')}>
          <MonthBars points={data.months} />
        </Card>
        <Card title={t('dash.topProducts')}>
          {data.top.length === 0 ? (
            <p className="muted">{t('dash.noSalesYet')}</p>
          ) : (
            <ol className="rank">
              {data.top.map((p, i) => (
                <li key={p.product_id}>
                  <span className="rank-n">{num(i + 1)}</span>
                  <Link to={`/stock/${p.product_id}`} className="rank-name">{p.name}</Link>
                  <span className="num">{money(p.revenue_cents)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title={t('dash.aging')} actions={<Link to="/reports" className="link-sm">{t('common.more')}</Link>}>
          <AgingBars rows={data.aging} />
        </Card>
        <Card title={t('dash.latePayers')}>
          {data.overdue.length === 0 ? (
            <p className="muted">{t('dash.noOverdue')}</p>
          ) : (
            <ul className="plain-list">
              {data.overdue.map((i) => (
                <li key={i.id}>
                  <Link to={`/invoices/${i.id}`} className="split">
                    <span><strong>{i.customer_name}</strong><br /><small className="muted">{i.number} · {t('invoice.daysLate', { n: num(i.days_overdue) })}</small></span>
                    <span className="num">{money(i.balance_cents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.low.length > 0 && (
            <>
              <h3 className="sub">{t('dash.lowStock')}</h3>
              <ul className="plain-list">
                {data.low.map((p) => (
                  <li key={p.id}>
                    <Link to={`/stock/${p.id}`} className="split">
                      <span>{p.name}</span>
                      <span className="num warn-text">{t('stock.leftOf', { n: num(p.on_hand), level: num(p.reorder_level) })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
