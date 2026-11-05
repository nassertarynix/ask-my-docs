import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  cancelPurchaseOrder, centsToInput, createPurchaseOrder, deletePurchaseOrder, getPurchaseOrder, listContacts, listProducts,
  listPurchaseOrders, placePurchaseOrder, receivePurchaseOrder, updatePurchaseOrder,
} from '../../domain';
import { Card, Chips, Empty, Field, PageHeader, Row, SearchBox, StatusPill, TextField, useConfirm, useToday } from '../components';
import { useErp } from '../erp';
import { Icon } from '../icons';
import { useI18n } from '../i18n';
import { LineDraft, newLine, OrderLines, parseLines } from '../OrderLines';
import { ContactSheet } from './Contacts';

type Filter = 'all' | 'open' | 'received';

export function PurchaseList() {
  const { ctx, rev } = useErp();
  const { t, money, date } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter');
  const filter: Filter = raw === 'open' || raw === 'received' ? raw : 'all';
  const [query, setQuery] = useState('');
  const orders = useMemo(() => listPurchaseOrders(ctx), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOpen = (status: string) => status === 'draft' || status === 'ordered';
  const needle = query.trim().toLowerCase();
  const shown = orders.filter((o) => {
    if (filter === 'open' && !isOpen(o.status)) return false;
    if (filter === 'received' && o.status !== 'received') return false;
    return !needle || o.number.toLowerCase().includes(needle) || o.supplier_name.toLowerCase().includes(needle);
  });

  return (
    <>
      <PageHeader title={t('nav.purchases')} actions={<Link to="/purchases/new" className="btn primary"><Icon name="plus" size={18} />{t('purchase.new')}</Link>} />
      <Chips
        value={filter}
        onChange={(v) => setParams(v === 'all' ? {} : { filter: v })}
        options={[
          { value: 'all', label: t('filter.all'), count: orders.length },
          { value: 'open', label: t('filter.open'), count: orders.filter((o) => isOpen(o.status)).length },
          { value: 'received', label: t('filter.received'), count: orders.filter((o) => o.status === 'received').length },
        ]}
      />
      <SearchBox value={query} onChange={setQuery} placeholder={t('common.search')} />
      {shown.length === 0 ? (
        <Empty icon="truck" title={orders.length === 0 ? t('purchase.none') : t('common.noResults')} text={orders.length === 0 ? t('purchase.noneText') : undefined}
          action={orders.length === 0 && <Link className="btn primary" to="/purchases/new">{t('purchase.new')}</Link>} />
      ) : (
        <div className="list card flush">
          {shown.slice(0, 100).map((o) => (
            <Row key={o.id} to={`/purchases/${o.id}`}>
              <span className="split">
                <span><strong>{o.supplier_name}</strong><br /><small className="muted">{o.number} · {date(o.order_date)}</small></span>
                <span className="right"><span className="num">{money(o.total_cents)}</span><StatusPill status={o.status} /></span>
              </span>
            </Row>
          ))}
        </div>
      )}
    </>
  );
}

export function PurchaseDetail() {
  const id = Number(useParams().id);
  const { ctx, rev, act } = useErp();
  const { t, money, date, num } = useI18n();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const order = useMemo(() => { try { return getPurchaseOrder(ctx, id); } catch { return null; } }, [ctx, rev, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return <Empty title={t('common.notFound')} action={<Link className="btn" to="/purchases">{t('common.back')}</Link>} />;

  const doCancel = async () => {
    if (await confirm({ title: t('purchase.cancelTitle'), confirmLabel: t('purchase.cancel'), danger: true })) act((c) => cancelPurchaseOrder(c, id), t('purchase.cancelled'));
  };
  const doDelete = async () => {
    if (await confirm({ title: t('purchase.deleteTitle'), confirmLabel: t('common.delete'), danger: true })) {
      if (act((c) => deletePurchaseOrder(c, id), t('purchase.deleted')) !== undefined) navigate('/purchases');
    }
  };

  return (
    <>
      <PageHeader title={order.number} subtitle={date(order.order_date)} back="/purchases" actions={<StatusPill status={order.status} />} />
      <Card>
        <dl className="facts">
          <div><dt>{t('purchase.supplier')}</dt><dd><Link to={`/contacts/${order.supplier_id}`}>{order.supplier_name}</Link></dd></div>
          {order.received_date && <div><dt>{t('purchase.receivedOn')}</dt><dd>{date(order.received_date)}</dd></div>}
          {order.note && <div><dt>{t('common.note')}</dt><dd>{order.note}</dd></div>}
        </dl>
      </Card>
      <Card title={t('sales.lines')}>
        <ul className="doc-lines">
          {order.lines.map((l) => (
            <li key={l.id}>
              <span><Link to={`/stock/${l.product_id}`}><strong>{l.product_name}</strong></Link><br /><small className="muted">{num(l.qty)} × {money(l.unit_cost_cents)}</small></span>
              <span className="num">{money(l.total_cents)}</span>
            </li>
          ))}
        </ul>
        <dl className="totals"><div className="grand"><dt>{t('totals.total')}</dt><dd className="num">{money(order.total_cents)}</dd></div></dl>
      </Card>
      <div className="actions">
        {order.status === 'draft' && (
          <>
            <button className="btn primary" onClick={() => act((c) => placePurchaseOrder(c, id), t('purchase.placed'))}><Icon name="truck" size={18} />{t('purchase.place')}</button>
            <Link className="btn" to={`/purchases/${id}/edit`}><Icon name="edit" size={18} />{t('common.edit')}</Link>
            <button className="btn danger-outline" onClick={doDelete}><Icon name="trash" size={18} />{t('common.delete')}</button>
          </>
        )}
        {order.status === 'ordered' && (
          <>
            <button className="btn primary" onClick={() => act((c) => receivePurchaseOrder(c, id), t('purchase.receivedMsg'))}><Icon name="check" size={18} />{t('purchase.receive')}</button>
            <button className="btn danger-outline" onClick={doCancel}>{t('purchase.cancel')}</button>
          </>
        )}
      </div>
      {order.status === 'ordered' && <p className="muted hint">{t('purchase.receiveHint')}</p>}
      {dialog}
    </>
  );
}

export function PurchaseEditor() {
  const idParam = useParams().id;
  const editId = idParam ? Number(idParam) : undefined;
  const { ctx, rev, act } = useErp();
  const { t } = useI18n();
  const navigate = useNavigate();
  const today = useToday();
  const existing = useMemo(() => { if (editId === undefined) return null; try { return getPurchaseOrder(ctx, editId); } catch { return null; } }, [ctx, editId]);  
  const suppliers = useMemo(() => listContacts(ctx, 'supplier'), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const products = useMemo(() => listProducts(ctx), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const [supplierId, setSupplierId] = useState(existing ? String(existing.supplier_id) : '');
  const [orderDate, setOrderDate] = useState(existing?.order_date ?? today);
  const [note, setNote] = useState(existing?.note ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    existing ? existing.lines.map((l) => ({ ...newLine(), productId: String(l.product_id), qty: String(l.qty), price: centsToInput(l.unit_cost_cents) })) : [newLine()],
  );
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [supplierError, setSupplierError] = useState('');
  const [adding, setAdding] = useState(false);

  if (editId !== undefined && (!existing || existing.status !== 'draft')) {
    return <Empty title={t('sales.cannotEdit')} action={<Link className="btn" to={`/purchases/${editId}`}>{t('common.back')}</Link>} />;
  }

  const save = () => {
    setSupplierError(supplierId ? '' : t('purchase.pickSupplier'));
    const { parsed, errors, ok } = parseLines(lines, { product: t('line.errProduct'), qty: t('line.errQty'), price: t('line.errPrice') });
    setLineErrors(errors);
    if (!supplierId || !ok) return;
    const input = { supplierId: Number(supplierId), date: orderDate, note, lines: parsed.map((l) => ({ productId: l.productId, qty: l.qty, unitCostCents: l.cents })) };
    const id = act((c) => (editId === undefined ? createPurchaseOrder(c, input) : (updatePurchaseOrder(c, editId, input), editId)), t('purchase.saved'));
    if (id !== undefined) navigate(`/purchases/${id}`, { replace: true });
  };

  return (
    <>
      <PageHeader title={editId === undefined ? t('purchase.new') : t('purchase.edit')} back={editId === undefined ? '/purchases' : `/purchases/${editId}`} />
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Card>
          <Field label={t('purchase.supplier')} htmlFor="supplier" error={supplierError}>
            <div className="inline">
              <select id="supplier" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setSupplierError(''); }}>
                <option value="">{t('purchase.choose')}</option>
                {suppliers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" className="icon-btn outlined" onClick={() => setAdding(true)} aria-label={t('contacts.newSupplier')}><Icon name="plus" /></button>
            </div>
          </Field>
          <TextField label={t('common.date')} type="date" value={orderDate} onChange={setOrderDate} />
          <TextField label={t('common.note')} value={note} onChange={setNote} autoComplete="off" />
        </Card>
        <Card title={t('sales.lines')}>
          <OrderLines lines={lines} onChange={setLines} products={products} kind="purchase" errors={lineErrors} />
        </Card>
        <div className="actions sticky"><button type="submit" className="btn primary">{t('common.save')}</button></div>
      </form>
      {adding && <ContactSheet open kind="supplier" onClose={() => setAdding(false)} onSaved={(id) => setSupplierId(String(id))} />}
    </>
  );
}
