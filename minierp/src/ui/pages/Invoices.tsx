import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { centsToInput, getInvoice, getSalesOrder, Invoice, listInvoices, listPayments, parseMoney, recordPayment, voidInvoice } from '../../domain';
import { Card, Chips, Empty, PageHeader, Row, SearchBox, Sheet, StatusPill, TextField, useConfirm } from '../components';
import { useErp } from '../erp';
import { Icon } from '../icons';
import { MessageKey, useI18n } from '../i18n';

type Filter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'void';

const matches = (i: Invoice, f: Filter) =>
  f === 'all' ? true : f === 'unpaid' ? i.status === 'unpaid' || i.status === 'partial' || i.status === 'overdue' : i.status === f;

export function InvoiceList() {
  const { ctx, rev } = useErp();
  const { t, money, date } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter');
  const filter: Filter = raw === 'unpaid' || raw === 'overdue' || raw === 'paid' || raw === 'void' ? raw : 'all';
  const [query, setQuery] = useState('');
  const invoices = useMemo(() => listInvoices(ctx), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = query.trim().toLowerCase();
  const shown = invoices.filter((i) => matches(i, filter) && (!needle || i.number.toLowerCase().includes(needle) || i.customer_name.toLowerCase().includes(needle)));
  const owed = shown.reduce((s, i) => s + i.balance_cents, 0);

  return (
    <>
      <PageHeader title={t('nav.invoices')} subtitle={filter !== 'paid' && filter !== 'void' && shown.length > 0 ? t('invoice.owedTotal', { amount: money(owed) }) : undefined} />
      <Chips
        value={filter}
        onChange={(v) => setParams(v === 'all' ? {} : { filter: v })}
        options={(['all', 'unpaid', 'overdue', 'paid', 'void'] as Filter[]).map((f) => ({ value: f, label: t(`filter.${f}` as MessageKey), count: invoices.filter((i) => matches(i, f)).length }))}
      />
      <SearchBox value={query} onChange={setQuery} placeholder={t('common.search')} />
      {shown.length === 0 ? (
        <Empty icon="invoice" title={invoices.length === 0 ? t('invoice.none') : t('common.noResults')} text={invoices.length === 0 ? t('invoice.noneText') : undefined} />
      ) : (
        <div className="list card flush">
          {shown.slice(0, 150).map((i) => (
            <Row key={i.id} to={`/invoices/${i.id}`}>
              <span className="split">
                <span><strong>{i.customer_name}</strong><br /><small className="muted">{i.number} · {i.status === 'overdue' ? t('invoice.daysLate', { n: i.days_overdue }) : t('invoice.dueOn', { date: date(i.due_date) })}</small></span>
                <span className="right"><span className="num">{money(i.status === 'paid' || i.status === 'void' ? i.total_cents : i.balance_cents)}</span><StatusPill status={i.status} /></span>
              </span>
            </Row>
          ))}
        </div>
      )}
    </>
  );
}

const METHODS = ['cash', 'bank', 'card'] as const;

function PaymentSheet({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { act, ctx } = useErp();
  const { t, money } = useI18n();
  const [amount, setAmount] = useState(centsToInput(invoice.balance_cents));
  const [method, setMethod] = useState<string>('bank');
  const [paidDate, setPaidDate] = useState(ctx.today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) return setError(t('error.invalid_amount'));
    if (cents > invoice.balance_cents) return setError(t('error.overpayment', { balance: money(invoice.balance_cents), amount: money(cents) }));
    if (act((c) => recordPayment(c, invoice.id, { amountCents: cents, method, date: paidDate, note }), t('payment.recorded')) !== undefined) onClose();
  };

  return (
    <Sheet open title={t('payment.record')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{t('payment.save')}</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="muted">{t('payment.balance', { amount: money(invoice.balance_cents) })}</p>
        <TextField label={t('payment.amount')} value={amount} onChange={(v) => { setAmount(v); setError(''); }} inputMode="decimal" error={error} autoFocus autoComplete="off" />
        <div className="field">
          <label htmlFor="method">{t('payment.method')}</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m} value={m}>{t(`method.${m}` as MessageKey)}</option>)}
          </select>
        </div>
        <TextField label={t('common.date')} type="date" value={paidDate} onChange={setPaidDate} />
        <TextField label={t('common.note')} value={note} onChange={setNote} autoComplete="off" />
      </form>
    </Sheet>
  );
}

export function InvoiceDetail() {
  const id = Number(useParams().id);
  const { ctx, rev, act } = useErp();
  const { t, money, date, num, percent } = useI18n();
  const { confirm, dialog } = useConfirm();
  const [paying, setPaying] = useState(false);

  const data = useMemo(() => {
    try {
      const invoice = getInvoice(ctx, id);
      return { invoice, order: getSalesOrder(ctx, invoice.order_id), payments: listPayments(ctx, id) };
    } catch {
      return null;
    }
  }, [ctx, rev, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Empty title={t('common.notFound')} action={<Link className="btn" to="/invoices">{t('common.back')}</Link>} />;
  const { invoice, order, payments } = data;
  const canPay = invoice.stored_status === 'open' && invoice.balance_cents > 0;

  const doVoid = async () => {
    if (await confirm({ title: t('invoice.voidTitle'), text: t('invoice.voidText'), confirmLabel: t('invoice.void'), danger: true })) {
      act((c) => voidInvoice(c, id), t('invoice.voided'));
    }
  };

  return (
    <>
      <PageHeader title={invoice.number} subtitle={invoice.customer_name} back="/invoices" actions={<StatusPill status={invoice.status} />} />

      <Card className="invoice-sheet">
        <dl className="facts">
          <div><dt>{t('sales.customer')}</dt><dd><Link to={`/contacts/${invoice.customer_id}`}>{invoice.customer_name}</Link></dd></div>
          <div><dt>{t('invoice.issued')}</dt><dd>{date(invoice.issue_date)}</dd></div>
          <div><dt>{t('invoice.due')}</dt><dd>{date(invoice.due_date)}{invoice.status === 'overdue' ? ` · ${t('invoice.daysLate', { n: num(invoice.days_overdue) })}` : ''}</dd></div>
          <div><dt>{t('nav.sales')}</dt><dd><Link to={`/sales/${invoice.order_id}`}>{invoice.order_number}</Link></dd></div>
        </dl>
        <ul className="doc-lines">
          {order.lines.map((l) => (
            <li key={l.id}>
              <span><strong>{l.product_name}</strong><br /><small className="muted">{num(l.qty)} × {money(l.unit_price_cents)}{l.tax_bps > 0 ? ` · ${t('totals.tax')} ${percent(l.tax_bps)}` : ''}</small></span>
              <span className="num">{money(l.amounts.net)}</span>
            </li>
          ))}
        </ul>
        <dl className="totals">
          <div><dt>{t('totals.subtotal')}</dt><dd className="num">{money(invoice.net_cents)}</dd></div>
          <div><dt>{t('totals.tax')}</dt><dd className="num">{money(invoice.tax_cents)}</dd></div>
          <div className="grand"><dt>{t('totals.total')}</dt><dd className="num">{money(invoice.total_cents)}</dd></div>
          <div><dt>{t('invoice.paid')}</dt><dd className="num">{money(invoice.paid_cents)}</dd></div>
          <div className="grand"><dt>{t('invoice.balance')}</dt><dd className="num">{money(invoice.balance_cents)}</dd></div>
        </dl>
      </Card>

      <div className="actions no-print">
        {canPay && <button className="btn primary" onClick={() => setPaying(true)}><Icon name="cash" size={18} />{t('payment.record')}</button>}
        <button className="btn" onClick={() => window.print()}><Icon name="download" size={18} />{t('invoice.print')}</button>
        {invoice.stored_status === 'open' && invoice.paid_cents === 0 && <button className="btn danger-outline" onClick={doVoid}>{t('invoice.void')}</button>}
      </div>

      <Card title={t('payment.title')} className="no-print">
        {payments.length === 0 ? <p className="muted">{t('payment.none')}</p> : (
          <ul className="plain-list">
            {payments.map((p) => (
              <li key={p.id} className="split"><span>{date(p.paid_date)}<br /><small className="muted">{t(`method.${p.method}` as MessageKey)}{p.note ? ` · ${p.note}` : ''}</small></span><span className="num">{money(p.amount_cents)}</span></li>
            ))}
          </ul>
        )}
      </Card>
      {paying && <PaymentSheet invoice={invoice} onClose={() => setPaying(false)} />}
      {dialog}
    </>
  );
}
