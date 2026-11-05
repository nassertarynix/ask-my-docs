import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Contact, ContactKind, createContact, customerBalances, deleteContact, getContact, listContacts, listInvoices,
  listPurchaseOrders, listSalesOrders, updateContact,
} from '../../domain';
import { Card, Chips, Empty, PageHeader, Row, SearchBox, Sheet, StatusPill, TextField, useConfirm } from '../components';
import { useErp } from '../erp';
import { Icon } from '../icons';
import { useI18n } from '../i18n';

/** Add or edit a customer/supplier. Also used as a quick-create from inside an order form. */
export function ContactSheet({ open, kind, contact, onClose, onSaved }: {
  open: boolean; kind: ContactKind; contact?: Contact; onClose: () => void; onSaved?: (id: number) => void;
}) {
  const { act } = useErp();
  const { t } = useI18n();
  const [name, setName] = useState(contact?.name ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [error, setError] = useState('');

  const save = () => {
    if (!name.trim()) return setError(t('error.invalid_name'));
    const id = act(
      (ctx) => {
        if (contact) {
          updateContact(ctx, contact.id, { name, email, phone, address });
          return contact.id;
        }
        return createContact(ctx, { kind, name, email, phone, address });
      },
      t('contacts.saved'),
    );
    if (id !== undefined) {
      onSaved?.(id);
      onClose();
    }
  };

  const title = contact ? t('contacts.edit') : kind === 'customer' ? t('contacts.newCustomer') : t('contacts.newSupplier');
  return (
    <Sheet open={open} title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{t('common.save')}</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label={t('contacts.name')} value={name} onChange={(v) => { setName(v); setError(''); }} error={error} autoFocus autoComplete="off" />
        <TextField label={t('contacts.email')} value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="off" />
        <TextField label={t('contacts.phone')} value={phone} onChange={setPhone} type="tel" inputMode="tel" autoComplete="off" />
        <TextField label={t('contacts.address')} value={address} onChange={setAddress} autoComplete="off" />
      </form>
    </Sheet>
  );
}

export function ContactList() {
  const { ctx, rev } = useErp();
  const { t, money } = useI18n();
  const [params, setParams] = useSearchParams();
  const kind: ContactKind = params.get('kind') === 'supplier' ? 'supplier' : 'customer';
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (c: Contact) => !needle || [c.name, c.email, c.phone].some((v) => v.toLowerCase().includes(needle));
    if (kind === 'customer') return customerBalances(ctx).filter(match);
    return listContacts(ctx, 'supplier').filter(match).map((c) => ({ ...c, balance_cents: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rev, kind, query]);

  return (
    <>
      <PageHeader
        title={t('nav.contacts')}
        actions={<button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('common.add')}</button>}
      />
      <Chips
        value={kind}
        onChange={(v) => setParams(v === 'customer' ? {} : { kind: v })}
        options={[{ value: 'customer', label: t('contacts.customers') }, { value: 'supplier', label: t('contacts.suppliers') }]}
      />
      <SearchBox value={query} onChange={setQuery} placeholder={t('common.search')} />
      {rows.length === 0 ? (
        <Empty icon="users" title={query ? t('common.noResults') : t('contacts.none')} action={!query && <button className="btn primary" onClick={() => setAdding(true)}>{t('common.add')}</button>} />
      ) : (
        <div className="list card flush">
          {rows.map((c) => (
            <Row key={c.id} to={`/contacts/${c.id}`}>
              <span className="split">
                <span><strong>{c.name}</strong><br /><small className="muted">{c.email || c.phone || ' '}</small></span>
                {kind === 'customer' && c.balance_cents > 0 && <span className="num">{money(c.balance_cents)}</span>}
              </span>
            </Row>
          ))}
        </div>
      )}
      {adding && <ContactSheet open kind={kind} onClose={() => setAdding(false)} />}
    </>
  );
}

export function ContactDetail() {
  const id = Number(useParams().id);
  const { ctx, rev, act } = useErp();
  const { t, money, date } = useI18n();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);

  const data = useMemo(() => {
    try {
      const contact = getContact(ctx, id);
      return {
        contact,
        orders: contact.kind === 'customer' ? listSalesOrders(ctx).filter((o) => o.customer_id === id) : [],
        invoices: contact.kind === 'customer' ? listInvoices(ctx).filter((i) => i.customer_id === id) : [],
        purchases: contact.kind === 'supplier' ? listPurchaseOrders(ctx).filter((o) => o.supplier_id === id) : [],
      };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rev, id]);

  if (!data) return <Empty title={t('common.notFound')} action={<Link className="btn" to="/contacts">{t('common.back')}</Link>} />;
  const { contact } = data;
  const owed = data.invoices.reduce((sum, i) => sum + i.balance_cents, 0);

  const remove = async () => {
    if (!(await confirm({ title: t('contacts.deleteTitle'), text: t('contacts.deleteText'), confirmLabel: t('common.delete'), danger: true }))) return;
    if (act((c) => deleteContact(c, id), t('contacts.deleted')) !== undefined || getSafe(ctx, id) === null) navigate(`/contacts${contact.kind === 'supplier' ? '?kind=supplier' : ''}`);
  };

  return (
    <>
      <PageHeader
        title={contact.name}
        subtitle={contact.kind === 'customer' ? t('contacts.customer') : t('contacts.supplier')}
        back={`/contacts${contact.kind === 'supplier' ? '?kind=supplier' : ''}`}
        actions={<button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} />{t('common.edit')}</button>}
      />
      <Card>
        <dl className="facts">
          <div><dt>{t('contacts.email')}</dt><dd>{contact.email || '—'}</dd></div>
          <div><dt>{t('contacts.phone')}</dt><dd dir="ltr" className="start">{contact.phone || '—'}</dd></div>
          <div><dt>{t('contacts.address')}</dt><dd>{contact.address || '—'}</dd></div>
          {contact.kind === 'customer' && <div><dt>{t('contacts.owes')}</dt><dd className="num">{money(owed)}</dd></div>}
        </dl>
      </Card>
      {contact.kind === 'customer' && (
        <Card title={t('nav.invoices')}>
          {data.invoices.length === 0 ? <p className="muted">{t('contacts.noDocs')}</p> : (
            <ul className="plain-list">
              {data.invoices.slice(0, 12).map((i) => (
                <li key={i.id}><Link to={`/invoices/${i.id}`} className="split"><span>{i.number}<br /><small className="muted">{date(i.issue_date)}</small></span><span className="right"><span className="num">{money(i.total_cents)}</span><StatusPill status={i.status} /></span></Link></li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {contact.kind === 'customer' && data.orders.length > 0 && (
        <Card title={t('nav.sales')}>
          <ul className="plain-list">
            {data.orders.slice(0, 8).map((o) => (
              <li key={o.id}><Link to={`/sales/${o.id}`} className="split"><span>{o.number}<br /><small className="muted">{date(o.order_date)}</small></span><span className="right"><span className="num">{money(o.totals.gross)}</span><StatusPill status={o.status} /></span></Link></li>
            ))}
          </ul>
        </Card>
      )}
      {contact.kind === 'supplier' && (
        <Card title={t('nav.purchases')}>
          {data.purchases.length === 0 ? <p className="muted">{t('contacts.noDocs')}</p> : (
            <ul className="plain-list">
              {data.purchases.map((o) => (
                <li key={o.id}><Link to={`/purchases/${o.id}`} className="split"><span>{o.number}<br /><small className="muted">{date(o.order_date)}</small></span><span className="right"><span className="num">{money(o.total_cents)}</span><StatusPill status={o.status} /></span></Link></li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <div className="actions"><button className="btn danger-outline" onClick={remove}><Icon name="trash" size={18} />{t('common.delete')}</button></div>
      {editing && <ContactSheet open kind={contact.kind} contact={contact} onClose={() => setEditing(false)} />}
      {dialog}
    </>
  );
}

function getSafe(ctx: Parameters<typeof getContact>[0], id: number) {
  try { return getContact(ctx, id); } catch { return null; }
}
