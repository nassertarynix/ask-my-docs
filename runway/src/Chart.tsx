import { useEffect, useId, useRef, useState } from 'react';
import type { Forecast, Settings } from './domain/forecast';
import { formatMoney } from './domain/money';

const H = 240, PAD = { l: 8, r: 8, t: 14, b: 44 };

function days(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

/** The balance as a step line: it only changes on the day something happens. Hand-drawn SVG, one scale for x and one for y. */
export function Chart({ forecast, settings }: { forecast: Forecast; settings: Settings }) {
  const id = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const span = Math.max(1, days(settings.start, forecast.end));
  const points: [number, number][] = [[0, settings.opening]];
  for (const e of forecast.events) points.push([days(settings.start, e.date), e.balance]);
  points.push([span, forecast.closing]);

  const values = points.map((p) => p[1]).concat(0);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi === lo) hi = lo + 100;
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (d: number) => PAD.l + (d / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  const zero = y(0);

  let line = `M ${x(points[0]![0])} ${y(points[0]![1])}`;
  for (let i = 1; i < points.length; i++) line += ` H ${x(points[i]![0])} V ${y(points[i]![1])}`;
  const area = `${line} V ${zero} H ${x(0)} Z`;

  const ticks: { x: number; label: string }[] = [];
  forecast.months.forEach((m, n) => {
    if (forecast.months.length * 34 > W && n % 2) return;
    const d = n === 0 ? 0 : days(settings.start, `${m.month}-01`);
    const label = new Date(`${m.month}-01T00:00:00Z`).toLocaleString('en', { month: 'short', timeZone: 'UTC' });
    ticks.push({ x: x(Math.max(0, d)), label });
  });
  const lowX = x(days(settings.start, forecast.lowest.date)), lowY = y(forecast.lowest.balance);
  const anchor = lowX > W - 100 ? 'end' : lowX < 100 ? 'start' : 'middle';

  return (
    <div ref={box} className="chart-box">
    <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Balance over time. Lowest ${formatMoney(forecast.lowest.balance)} on ${forecast.lowest.date}. Ends at ${formatMoney(forecast.closing)}.`}>
      <defs>
        <clipPath id={`${id}a`}><rect x="0" y="0" width={W} height={zero} /></clipPath>
        <clipPath id={`${id}b`}><rect x="0" y={zero} width={W} height={Math.max(0, H - zero)} /></clipPath>
      </defs>
      <path d={area} className="area-up" clipPath={`url(#${id}a)`} />
      <path d={area} className="area-down" clipPath={`url(#${id}b)`} />
      <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} className="zero" />
      <path d={line} className="trace" fill="none" />
      {ticks.map((t) => (
        <text key={t.x} x={t.x} y={H - 8} className="tick" textAnchor="start">{t.label}</text>
      ))}
      <circle cx={lowX} cy={lowY} r="5" className={forecast.lowest.balance < 0 ? 'dot bad' : 'dot'} />
      <text x={lowX} y={lowY + 20} textAnchor={anchor} className="lowlabel">Lowest {formatMoney(forecast.lowest.balance)}</text>
    </svg>
    </div>
  );
}
