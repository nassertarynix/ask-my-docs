import { AgingRow, MonthPoint } from '../domain';
import { MessageKey, useI18n } from './i18n';

/**
 * Charts are plain SVG/HTML written by hand: no charting library, so the bundle stays small and
 * every colour comes from the same CSS variables as the rest of the app (light and dark both work).
 * Each chart also ships a real table for screen readers.
 */
export function MonthBars({ points }: { points: MonthPoint[] }) {
  const { t, money, monthLabel } = useI18n();
  const width = 320;
  const height = 168;
  const left = 4;
  const bottom = 24;
  const top = 12;
  const max = Math.max(1, ...points.map((p) => p.revenue_cents));
  const slot = (width - left * 2) / points.length;
  const barWidth = Math.min(32, slot * 0.62);
  const scale = (value: number) => ((height - bottom - top) * value) / max;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('chart.salesByMonth')} preserveAspectRatio="xMidYMid meet">
        <line x1={left} x2={width - left} y1={height - bottom} y2={height - bottom} className="chart-axis" />
        {points.map((p, i) => {
          const x = left + slot * i + (slot - barWidth) / 2;
          const revenueHeight = scale(p.revenue_cents);
          const profitHeight = scale(Math.max(0, p.profit_cents));
          return (
            <g key={p.month}>
              <rect x={x} y={height - bottom - revenueHeight} width={barWidth} height={revenueHeight} rx={3} className="bar-revenue" />
              <rect x={x} y={height - bottom - profitHeight} width={barWidth} height={profitHeight} rx={3} className="bar-profit" />
              <text x={x + barWidth / 2} y={height - 7} textAnchor="middle" className="chart-label">{monthLabel(p.month)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        <span><i className="swatch revenue" />{t('chart.revenue')}</span>
        <span><i className="swatch profit" />{t('chart.profit')}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{t('chart.salesByMonth')}</caption>
        <thead><tr><th>{t('chart.month')}</th><th>{t('chart.revenue')}</th><th>{t('chart.profit')}</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}><td>{monthLabel(p.month, 'long')}</td><td>{money(p.revenue_cents)}</td><td>{money(p.profit_cents)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const BUCKET_CLASS: Record<AgingRow['bucket'], string> = {
  current: 'b-current', d1_30: 'b-1', d31_60: 'b-2', d61_90: 'b-3', d90_plus: 'b-4',
};

export function AgingBars({ rows }: { rows: AgingRow[] }) {
  const { t, money, num } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.balance_cents));
  return (
    <div className="aging">
      {rows.map((row) => (
        <div className="aging-row" key={row.bucket}>
          <span className="aging-label">{t(`aging.${row.bucket}` as MessageKey)}</span>
          <span className="aging-track" aria-hidden="true">
            <span className={`aging-fill ${BUCKET_CLASS[row.bucket]}`} style={{ inlineSize: `${(row.balance_cents / max) * 100}%` }} />
          </span>
          <span className="aging-value num">{money(row.balance_cents)}</span>
          <span className="sr-only">{t('aging.invoicesCount', { n: num(row.count) })}</span>
        </div>
      ))}
    </div>
  );
}
