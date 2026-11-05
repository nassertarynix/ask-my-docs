import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  adjustStock, centsToInput, createProduct, getProduct, listMoves, listProducts, parseMoney, parsePercentToBps,
  ProductWithStock, setProductActive, updateProduct,
} from '../../domain';
import { Card, Chips, Empty, MoneyField, PageHeader, Row, SearchBox, Sheet, TextField } from '../components';
import { useErp } from '../erp';
import { Icon } from '../icons';
import { MessageKey, useI18n } from '../i18n';

type Filter = 'all' | 'low' | 'out';

function ProductSheet({ product, onClose }: { product?: ProductWithStock; onClose: () => void }) {
  const { act } = useErp();
  const { t } = useI18n();
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'pcs');
  const [price, setPrice] = useState(product ? centsToInput(product.price_cents) : '');
  const [tax, setTax] = useState(product ? String(product.tax_bps / 100) : '0');
  const [reorder, setReorder] = useState(String(product?.reorder_level ?? 0));
  const [openingQty, setOpeningQty] = useState('');
  const [openingCost, setOpeningCost] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const next: Record<string, string> = {};
    const priceCents = parseMoney(price);
    const taxBps = parsePercentToBps(tax);
    const reorderLevel = /^\d+$/.test(reorder.trim()) ? Number(reorder.trim()) : null;
    const qty = openingQty.trim() === '' ? 0 : /^\d+$/.test(openingQty.trim()) ? Number(openingQty.trim()) : null;
    const costCents = openingCost.trim() === '' ? 0 : parseMoney(openingCost);
    if (!name.trim()) next.name = t('error.invalid_name');
    if (!sku.trim() || /\s/.test(sku.trim())) next.sku = t('error.invalid_sku');
    if (priceCents === null) next.price = t('error.invalid_amount');
    if (taxBps === null) next.tax = t('error.invalid_amount');
    if (reorderLevel === null) next.reorder = t('error.invalid_quantity');
    if (qty === null) next.qty = t('error.invalid_quantity');
    if (costCents === null) next.cost = t('error.invalid_amount');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const input = { sku, name, unit, price_cents: priceCents as number, tax_bps: taxBps as number, reorder_level: reorderLevel as number };
    const ok = act((ctx) => {
      if (product) {
        updateProduct(ctx, product.id, input);
        return true;
      }
      const id = createProduct(ctx, { ...input, cost_cents: costCents as number });
      if ((qty as number) > 0) adjustStock(ctx, id, qty as number, t('stock.openingNote'));
      return true;
    }, t('stock.saved'));
    if (ok) onClose();
  };

  return (
    <Sheet open title={product ? t('stock.edit') : t('stock.new')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{t('common.save')}</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label={t('stock.name')} value={name} onChange={setName} error={errors.name} autoFocus autoComplete="off" />
        <div className="two">
          <TextField label={t('stock.sku')} value={sku} onChange={setSku} error={errors.sku} autoComplete="off" autoCapitalize="characters" />
          <TextField label={t('stock.unit')} value={unit} onChange={setUnit} autoComplete="off" />
        </div>
        <div className="two">
          <MoneyField label={t('stock.price')} value={price} onChange={setPrice} error={errors.price} />
          <TextField label={t('stock.tax')} value={tax} onChange={setTax} inputMode="decimal" error={errors.tax} hint={t('stock.taxHint')} autoComplete="off" />
        </div>
        <TextField label={t('stock.reorder')} value={reorder} onChange={setReorder} inputMode="numeric" error={errors.reorder} hint={t('stock.reorderHint')} autoComplete="off" />
        {!product && (
          <div className="two">
            <TextField label={t('stock.openingQty')} value={openingQty} onChange={setOpeningQty} inputMode="numeric" error={errors.qty} autoComplete="off" />
            <MoneyField label={t('stock.openingCost')} value={openingCost} onChange={setOpeningCost} error={errors.cost} />
          </div>
        )}
      </form>
    </Sheet>
  );
}

export function StockList() {
  const { ctx, rev } = useErp();
  const { t, money, num } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter');
  const filter: Filter = raw === 'low' || raw === 'out' ? raw : 'all';
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const products = useMemo(() => listProducts(ctx), [ctx, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLow = (p: ProductWithStock) => p.reorder_level > 0 && p.on_hand <= p.reorder_level;
  const needle = query.trim().toLowerCase();
  const shown = products.filter((p) => {
    if (filter === 'low' && !isLow(p)) return false;
    if (filter === 'out' && p.on_hand > 0) return false;
    return !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle);
  });

  return (
    <>
      <PageHeader title={t('nav.stock')} actions={<button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('stock.new')}</button>} />
      <Chips
        value={filter}
        onChange={(v) => setParams(v === 'all' ? {} : { filter: v })}
        options={[
          { value: 'all', label: t('filter.all'), count: products.length },
          { value: 'low', label: t('filter.low'), count: products.filter(isLow).length },
          { value: 'out', label: t('filter.out'), count: products.filter((p) => p.on_hand <= 0).length },
        ]}
      />
      <SearchBox value={query} onChange={setQuery} placeholder={t('common.search')} />
      {shown.length === 0 ? (
        <Empty icon="stock" title={products.length === 0 ? t('stock.none') : t('common.noResults')} text={products.length === 0 ? t('stock.noneText') : undefined}
          action={products.length === 0 && <button className="btn primary" onClick={() => setAdding(true)}>{t('stock.new')}</button>} />
      ) : (
        <div className="list card flush">
          {shown.map((p) => (
            <Row key={p.id} to={`/stock/${p.id}`}>
              <span className="split">
                <span><strong>{p.name}</strong><br /><small className="muted">{p.sku} · {money(p.price_cents)}</small></span>
                <span className="right">
                  <span className={`num qty ${p.on_hand <= 0 ? 'bad-text' : isLow(p) ? 'warn-text' : ''}`}>{num(p.on_hand)} <small>{p.unit}</small></span>
                  {p.on_hand <= 0 ? <span className="pill pill-void">{t('stock.out')}</span> : isLow(p) ? <span className="pill pill-partial">{t('stock.low')}</span> : null}
                </span>
              </span>
            </Row>
          ))}
        </div>
      )}
      {adding && <ProductSheet onClose={() => setAdding(false)} />}
    </>
  );
}

function AdjustSheet({ product, onClose }: { product: ProductWithStock; onClose: () => void }) {
  const { act } = useErp();
  const { t, num } = useI18n();
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const n = /^[+-]?\d+$/.test(delta.trim()) ? Number(delta.trim()) : 0;
    const next: Record<string, string> = {};
    if (n === 0) next.delta = t('error.invalid_quantity');
    if (!note.trim()) next.note = t('stock.reasonRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (act((c) => adjustStock(c, product.id, n, note), t('stock.adjusted')) !== undefined) onClose();
  };

  return (
    <Sheet open title={t('stock.adjust')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{t('common.save')}</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="muted">{t('stock.currentlyHave', { n: num(product.on_hand), unit: product.unit })}</p>
        <TextField label={t('stock.change')} value={delta} onChange={setDelta} inputMode="numeric" hint={t('stock.changeHint')} error={errors.delta} autoFocus autoComplete="off" />
        <TextField label={t('stock.reason')} value={note} onChange={setNote} error={errors.note} autoComplete="off" />
      </form>
    </Sheet>
  );
}

export function ProductDetail() {
  const id = Number(useParams().id);
  const { ctx, rev, act } = useErp();
  const { t, money, num, date, percent } = useI18n();
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const data = useMemo(() => {
    try { return { product: getProduct(ctx, id), moves: listMoves(ctx, id, 60) }; } catch { return null; }
  }, [ctx, rev, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Empty title={t('common.notFound')} action={<Link className="btn" to="/stock">{t('common.back')}</Link>} />;
  const { product, moves } = data;

  return (
    <>
      <PageHeader title={product.name} subtitle={product.sku} back="/stock" actions={<button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={18} />{t('common.edit')}</button>} />
      {!product.active && <div className="banner"><Icon name="alert" size={20} /><div>{t('stock.archivedNote')}</div></div>}
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">{t('stock.onHand')}</span><strong className="kpi-value num">{num(product.on_hand)} <small>{product.unit}</small></strong></div>
        <div className="kpi"><span className="kpi-label">{t('stock.value')}</span><strong className="kpi-value num">{money(product.stock_value_cents)}</strong></div>
      </div>
      <Card>
        <dl className="facts">
          <div><dt>{t('stock.price')}</dt><dd className="num">{money(product.price_cents)}</dd></div>
          <div><dt>{t('stock.avgCost')}</dt><dd className="num">{money(product.cost_cents)}</dd></div>
          <div><dt>{t('stock.margin')}</dt><dd className="num">{product.price_cents > 0 ? percent(Math.round(((product.price_cents - product.cost_cents) / product.price_cents) * 10_000)) : '—'}</dd></div>
          <div><dt>{t('stock.tax')}</dt><dd>{percent(product.tax_bps)}</dd></div>
          <div><dt>{t('stock.reorder')}</dt><dd>{product.reorder_level > 0 ? num(product.reorder_level) : '—'}</dd></div>
        </dl>
      </Card>
      <div className="actions">
        <button className="btn primary" onClick={() => setAdjusting(true)}>{t('stock.adjust')}</button>
        <Link className="btn" to={`/sales/new`}>{t('sales.new')}</Link>
        <button className="btn" onClick={() => act((c) => setProductActive(c, id, !product.active), product.active ? t('stock.archived') : t('stock.restored'))}>
          {product.active ? t('stock.archive') : t('stock.restore')}
        </button>
      </div>
      <Card title={t('stock.history')}>
        {moves.length === 0 ? <p className="muted">{t('stock.noMoves')}</p> : (
          <ul className="plain-list">
            {moves.map((m) => (
              <li key={m.id} className="split">
                <span>{t(`move.${m.kind}` as MessageKey)}<br /><small className="muted">{date(m.move_date)}{m.note ? ` · ${m.note}` : ''}</small></span>
                <span className={`num ${m.qty > 0 ? 'good-text' : ''}`}>{m.qty > 0 ? '+' : '−'}{num(Math.abs(m.qty))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <ProductSheet product={product} onClose={() => setEditing(false)} />}
      {adjusting && <AdjustSheet product={product} onClose={() => setAdjusting(false)} />}
    </>
  );
}
