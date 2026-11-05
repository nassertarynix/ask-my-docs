import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  cancelSalesOrder, centsToInput, checkAvailability, confirmSalesOrder, createInvoice, createSalesOrder, deleteSalesOrder,
  getSalesOrder, listContacts, listProducts, listSalesOrders, SalesOrder, updateSalesOrder,
} from '../../domain';
import { Card, Chips, Empty, Field, PageHeader, Row, SearchBox, StatusPill, TextField, useConfirm, useToday } from '../components';
import { useErp } from '../erp';
import { Icon } from '../icons';
import { useI18n } from '../i18n';
import { LineDraft, newLine, OrderLines, parseLines } from '../OrderLines';
import { ContactSheet } from './Contacts';

type Filter = 'all' | 'open' | 'invoiced' | 'cancelled';

const isOpen = (o: SalesOrder) => o.status === 'draft' || (o.status === 'confirmed' && (!o.invoice || o.invoice.status === 'void'));

export function SalesList() {
  const { ctx, rev } = useErp();
  const { t, money, date } = useI18n();
  const [params, setParams] = useSearchParams();
  const filter = (['open', 'invoiced', 'cancelled'].includes(params.get('filter') ?? '') ? params.get('filter') : 'all') as Filter;
  const [query, setQuery] = useState('');

  const orders = useMemo(() => listSalesOrders(ctx), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = {
    all: orders.length,
    open: orders.filter(isOpen).length,
    invoiced: orders.filter((o) => o.invoice && o.invoice.status !== 'void').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  };
  const needle = query.trim().toLowerCase();
  const shown = orders.filter((o) => {
    if (filter === 'open' && !isOpen(o)) return false;
    if (filter === 'invoiced' && !(o.invoice && o.invoice.status !== 'void')) return false;
    if (filter === 'cancelled' && o.status !== 'cancelled') return false;
    return !needle || o.number.toLowerCase().includes(needle) || o.customer_name.toLowerCase().includes(needle);
  });

  return (
    <>
      <PageHeader title={t('nav.sales')} actions={<Link to="/sales/new" className="btn primary"><Icon name="plus" size={18} />{t('sales.new')}</Link>} />
      <Chips
        value={filter}
        onChange={(v) => setParams(v === 'all' ? {} : { filter: v })}
        options={[
          { value: 'all', label: t('filter.all'), count: counts.all },
          { value: 'open', label: t('filter.open'), count: counts.open },
          { value: 'invoiced', label: t('filter.invoiced'), count: counts.invoiced },
          { value: 'cancelled', label: t('filter.cancelled'), count: counts.cancelled },
        ]}
      />
      <SearchBox value={query} onChange={setQuery} placeholder={t('common.search')} />
      {shown.length === 0 ? (
        <Empty icon="sales" title={orders.length === 0 ? t('sales.none') : t('common.noResults')} text={orders.length === 0 ? t('sales.noneText') : undefined}
          action={orders.length === 0 && <Link className="btn primary" to="/sales/new">{t('sales.new')}</Link>} />
      ) : (
        <div className="list card flush">
          {shown.slice(0, 100).map((o) => (
            <Row key={o.id} to={`/sales/${o.id}`}>
              <span className="split">
                <span><strong>{o.customer_name}</strong><br /><small className="muted">{o.number} · {date(o.order_date)}</small></span>
                <span className="right"><span className="num">{money(o.totals.gross)}</span>
                  <StatusPill status={o.invoice && o.invoice.status !== 'void' ? o.invoice.status : o.status} /></span>
              </span>
            </Row>
          ))}
        </div>
      )}
    </>
  );
}

export function SalesDetail() {
  const id = Number(useParams().id);
  const { ctx, rev, act } = useErp();
  const { t, money, date, num, percent } = useI18n();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();

  const order = useMemo(() => {
    try { return getSalesOrder(ctx, id); } catch { return null; }
  }, [ctx, rev, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortages = useMemo(() => (order?.status === 'draft' ? checkAvailability(ctx, id) : []), [ctx, rev, id, order?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return <Empty title={t('common.notFound')} action={<Link className="btn" to="/sales">{t('common.back')}</Link>} />;

  const liveInvoice = order.invoice && order.invoice.status !== 'void' ? order.invoice : null;

  const doConfirm = () => act((c) => confirmSalesOrder(c, id), t('sales.confirmed'));
  const doInvoice = () => {
    const invoiceId = act((c) => createInvoice(c, id), t('invoice.created'));
    if (invoiceId !== undefined) navigate(`/invoices/${invoiceId}`);
  };
  const doCancel = async () => {
    if (await confirm({ title: t('sales.cancelTitle'), text: order.status === 'confirmed' ? t('sales.cancelText') : undefined, confirmLabel: t('sales.cancelConfirm'), danger: true })) {
      act((c) => cancelSalesOrder(c, id), t('sales.cancelled'));
    }
  };
  const doDelete = async () => {
    if (await confirm({ title: t('sales.deleteTitle'), confirmLabel: t('common.delete'), danger: true })) {
      if (act((c) => deleteSalesOrder(c, id), t('sales.deleted')) !== undefined) navigate('/sales');
    }
  };

  return (
    <>
      <PageHeader title={order.number} subtitle={date(order.order_date)} back="/sales" actions={<span className="pills"><StatusPill status={order.status} />{liveInvoice && <StatusPill status={liveInvoice.status} />}</span>} />

      <Card>
        <dl className="facts">
          <div><dt>{t('sales.customer')}</dt><dd><Link to={`/contacts/${order.customer_id}`}>{order.customer_name}</Link></dd></div>
          {order.note && <div><dt>{t('common.note')}</dt><dd>{order.note}</dd></div>}
          {liveInvoice && <div><dt>{t('nav.invoices')}</dt><dd><Link to={`/invoices/${liveInvoice.id}`}>{liveInvoice.number}</Link></dd></div>}
        </dl>
      </Card>

      {shortages.length > 0 && (
        <div className="banner warn" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>{t('sales.shortTitle')}</strong>
            <ul>{shortages.map((s) => <li key={s.productId}>{t('sales.shortLine', { product: s.product, requested: num(s.requested), available: num(s.available) })}</li>)}</ul>
          </div>
        </div>
      )}

      <Card title={t('sales.lines')}>
        <ul className="doc-lines">
          {order.lines.map((l) => (
            <li key={l.id}>
              <span><Link to={`/stock/${l.product_id}`}><strong>{l.product_name}</strong></Link><br />
                <small className="muted">{num(l.qty)} × {money(l.unit_price_cents)}{l.tax_bps > 0 ? ` · ${t('totals.tax')} ${percent(l.tax_bps)}` : ''}</small></span>
              <span className="num">{money(l.amounts.net)}</span>
            </li>
          ))}
        </ul>
        <dl className="totals">
          <div><dt>{t('totals.subtotal')}</dt><dd className="num">{money(order.totals.net)}</dd></div>
          <div><dt>{t('totals.tax')}</dt><dd className="num">{money(order.totals.tax)}</dd></div>
          <div className="grand"><dt>{t('totals.total')}</dt><dd className="num">{money(order.totals.gross)}</dd></div>
        </dl>
      </Card>

      <div className="actions">
        {order.status === 'draft' && (
          <>
            <button className="btn primary" onClick={doConfirm}><Icon name="check" size={18} />{t('sales.confirm')}</button>
            <Link className="btn" to={`/sales/${id}/edit`}><Icon name="edit" size={18} />{t('common.edit')}</Link>
            <button className="btn danger-outline" onClick={doDelete}><Icon name="trash" size={18} />{t('common.delete')}</button>
          </>
        )}
        {order.status === 'confirmed' && !liveInvoice && (
          <>
            <button className="btn primary" onClick={doInvoice}><Icon name="invoice" size={18} />{t('sales.createInvoice')}</button>
            <button className="btn danger-outline" onClick={doCancel}>{t('sales.cancel')}</button>
          </>
        )}
        {order.status === 'confirmed' && liveInvoice && (
          <Link className="btn primary" to={`/invoices/${liveInvoice.id}`}><Icon name="invoice" size={18} />{t('sales.openInvoice')}</Link>
        )}
      </div>
      {order.status === 'draft' && <p className="muted hint">{t('sales.confirmHint')}</p>}
      {dialog}
    </>
  );
}

export function SalesEditor() {
  const idParam = useParams().id;
  const editId = idParam ? Number(idParam) : undefined;
  const { ctx, rev, act } = useErp();
  const { t } = useI18n();
  const navigate = useNavigate();
  const today = useToday();
  const existing = useMemo(() => {
    if (editId === undefined) return null;
    try { return getSalesOrder(ctx, editId); } catch { return null; }
  }, [ctx, editId]);  
  const customers = useMemo(() => listContacts(ctx, 'customer'), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const products = useMemo(() => listProducts(ctx), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const [customerId, setCustomerId] = useState(existing ? String(existing.customer_id) : '');
  const [orderDate, setOrderDate] = useState(existing?.order_date ?? today);
  const [note, setNote] = useState(existing?.note ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    existing
      ? existing.lines.map((l) => ({ ...newLine(), productId: String(l.product_id), qty: String(l.qty), price: centsToInput(l.unit_price_cents) }))
      : [newLine()],
  );
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [customerError, setCustomerError] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);

  if (editId !== undefined && (!existing || existing.status !== 'draft')) {
    return <Empty title={t('sales.cannotEdit')} action={<Link className="btn" to={`/sales/${editId}`}>{t('common.back')}</Link>} />;
  }

  const save = () => {
    setCustomerError(customerId ? '' : t('sales.pickCustomer'));
    const { parsed, errors, ok } = parseLines(lines, { product: t('line.errProduct'), qty: t('line.errQty'), price: t('line.errPrice') });
    setLineErrors(errors);
    if (!customerId || !ok) return;
    const input = { customerId: Number(customerId), date: orderDate, note, lines: parsed.map((l) => ({ productId: l.productId, qty: l.qty, unitPriceCents: l.cents })) };
    const id = act((c) => (editId === undefined ? createSalesOrder(c, input) : (updateSalesOrder(c, editId, input), editId)), t('sales.saved'));
    if (id !== undefined) navigate(`/sales/${id}`, { replace: true });
  };

  return (
    <>
      <PageHeader title={editId === undefined ? t('sales.new') : t('sales.edit')} back={editId === undefined ? '/sales' : `/sales/${editId}`} />
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Card>
          <Field label={t('sales.customer')} htmlFor="customer" error={customerError}>
            <div className="inline">
              <select id="customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setCustomerError(''); }}>
                <option value="">{t('sales.choose')}</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" className="icon-btn outlined" onClick={() => setAddingCustomer(true)} aria-label={t('contacts.newCustomer')}><Icon name="plus" /></button>
            </div>
          </Field>
          <TextField label={t('common.date')} type="date" value={orderDate} onChange={setOrderDate} />
          <TextField label={t('common.note')} value={note} onChange={setNote} autoComplete="off" />
        </Card>
        <Card title={t('sales.lines')}>
          <OrderLines lines={lines} onChange={setLines} products={products} kind="sale" errors={lineErrors} />
        </Card>
        <div className="actions sticky">
          <button type="submit" className="btn primary">{t('common.save')}</button>
        </div>
      </form>
      {addingCustomer && <ContactSheet open kind="customer" onClose={() => setAddingCustomer(false)} onSaved={(id) => setCustomerId(String(id))} />}
    </>
  );
}
