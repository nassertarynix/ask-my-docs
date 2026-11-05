import { useId } from 'react';
import { centsToInput, lineAmounts, parseMoney, ProductWithStock, sumAmounts } from '../domain';
import { Field } from './components';
import { Icon } from './icons';
import { useI18n } from './i18n';

export interface LineDraft {
  key: number;
  productId: string;
  qty: string;
  price: string;
}

export type LineKind = 'sale' | 'purchase';

let counter = 1;
export const newLine = (): LineDraft => ({ key: counter++, productId: '', qty: '1', price: '' });

export interface ParsedLine {
  productId: number;
  qty: number;
  cents: number;
}

/** Turn what was typed into numbers; collects an error message per line instead of throwing. */
export function parseLines(lines: LineDraft[], messages: { product: string; qty: string; price: string }) {
  const parsed: ParsedLine[] = [];
  const errors: Record<number, string> = {};
  for (const line of lines) {
    const qty = /^\d+$/.test(line.qty.trim()) ? Number(line.qty.trim()) : 0;
    const cents = parseMoney(line.price);
    if (!line.productId) errors[line.key] = messages.product;
    else if (qty <= 0) errors[line.key] = messages.qty;
    else if (cents === null) errors[line.key] = messages.price;
    else parsed.push({ productId: Number(line.productId), qty, cents });
  }
  return { parsed, errors, ok: Object.keys(errors).length === 0 && parsed.length > 0 };
}

export function OrderLines({ lines, onChange, products, kind, errors }: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  products: ProductWithStock[];
  kind: LineKind;
  errors: Record<number, string>;
}) {
  const { t, money, num } = useI18n();
  const base = useId();
  const byId = new Map(products.map((p) => [String(p.id), p]));

  const update = (key: number, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const choose = (key: number, productId: string) => {
    const product = byId.get(productId);
    update(key, { productId, price: product ? centsToInput(kind === 'sale' ? product.price_cents : product.cost_cents) : '' });
  };

  const totals = sumAmounts(
    lines.flatMap((l) => {
      const product = byId.get(l.productId);
      const cents = parseMoney(l.price);
      const qty = /^\d+$/.test(l.qty.trim()) ? Number(l.qty.trim()) : 0;
      return product && cents !== null && qty > 0 ? [lineAmounts(qty, cents, kind === 'sale' ? product.tax_bps : 0)] : [];
    }),
  );

  return (
    <div className="lines">
      {lines.map((line, index) => {
        const product = byId.get(line.productId);
        const qty = /^\d+$/.test(line.qty.trim()) ? Number(line.qty.trim()) : 0;
        const cents = parseMoney(line.price);
        const shortfall = kind === 'sale' && product && qty > product.on_hand;
        const lineTotal = product && cents !== null ? qty * cents : null;
        return (
          <div className={`line-card ${errors[line.key] ? 'has-error' : ''}`} key={line.key} data-testid="order-line">
            <div className="line-top">
              <Field label={t('line.product')} htmlFor={`${base}-p-${line.key}`}>
                <select id={`${base}-p-${line.key}`} value={line.productId} onChange={(e) => choose(line.key, e.target.value)}>
                  <option value="">{t('line.choose')}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </Field>
              {lines.length > 1 && (
                <button type="button" className="icon-btn" onClick={() => onChange(lines.filter((l) => l.key !== line.key))} aria-label={t('line.remove', { n: num(index + 1) })}>
                  <Icon name="trash" />
                </button>
              )}
            </div>
            <div className="line-nums">
              <Field label={t('line.qty')} htmlFor={`${base}-q-${line.key}`}>
                <input id={`${base}-q-${line.key}`} inputMode="numeric" value={line.qty} onChange={(e) => update(line.key, { qty: e.target.value })} />
              </Field>
              <Field label={kind === 'sale' ? t('line.price') : t('line.cost')} htmlFor={`${base}-c-${line.key}`}>
                <input id={`${base}-c-${line.key}`} inputMode="decimal" value={line.price} onChange={(e) => update(line.key, { price: e.target.value })} placeholder="0.00" />
              </Field>
              <div className="line-total">
                <span className="muted">{t('line.total')}</span>
                <strong className="num">{lineTotal === null ? '—' : money(lineTotal)}</strong>
              </div>
            </div>
            {kind === 'sale' && product && (
              <small className={shortfall ? 'warn-text' : 'muted'}>
                {shortfall ? t('line.notEnough', { n: num(product.on_hand) }) : t('line.inStock', { n: num(product.on_hand) })}
              </small>
            )}
            {errors[line.key] && <small className="error-text" role="alert">{errors[line.key]}</small>}
          </div>
        );
      })}
      <button type="button" className="btn block" onClick={() => onChange([...lines, newLine()])}>
        <Icon name="plus" size={18} />{t('line.add')}
      </button>

      <dl className="totals">
        <div><dt>{t('totals.subtotal')}</dt><dd className="num">{money(totals.net)}</dd></div>
        {kind === 'sale' && <div><dt>{t('totals.tax')}</dt><dd className="num">{money(totals.tax)}</dd></div>}
        <div className="grand"><dt>{t('totals.total')}</dt><dd className="num">{money(totals.gross)}</dd></div>
      </dl>
    </div>
  );
}
