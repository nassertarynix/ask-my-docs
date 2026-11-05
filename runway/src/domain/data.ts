import { addMonths, isIso, localToday } from './dates';
import type { Every, Item, Settings } from './forecast';

export interface State { settings: Settings; items: Item[] }

const EVERY: Every[] = ['once', 'week', 'month', 'year'];

/** A small example business so the page opens with something to look at. It is shown as an example and can be cleared. */
export function exampleState(today: string = localToday()): State {
  const first = `${today.slice(0, 7)}-01`;
  const at = (months: number, day: string) => `${addMonths(first, months).slice(0, 7)}-${day}`;
  const mk = (id: string, name: string, kind: 'in' | 'out', dollars: number, every: Every, start: string, end = ''): Item =>
    ({ id, name, kind, amountCents: dollars * 100, every, start, end, enabled: true });
  return {
    settings: { opening: 1_200_000, start: first, months: 12 },
    items: [
      mk('e1', 'Wholesale orders', 'in', 8_200, 'month', at(0, '05')),
      mk('e2', 'Shop sales', 'in', 1_500, 'week', at(0, '02')),
      mk('e3', 'Rent', 'out', 3_200, 'month', at(0, '01')),
      mk('e4', 'Salaries', 'out', 7_400, 'month', at(0, '28')),
      mk('e5', 'Supplier payments', 'out', 3_600, 'month', at(0, '15')),
      mk('e6', 'Insurance', 'out', 2_400, 'year', at(2, '10')),
      mk('e7', 'New van', 'out', 14_000, 'once', at(4, '20')),
    ],
  };
}

export function emptyState(today: string = localToday()): State {
  return { settings: { opening: 0, start: `${today.slice(0, 7)}-01`, months: 12 }, items: [] };
}

/** Accepts anything that came out of storage or a file and returns a safe State, or null. Bad items are dropped, not trusted. */
export function readState(value: unknown): State | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { settings?: Record<string, unknown>; items?: unknown };
  const s = v.settings;
  if (!s || typeof s.opening !== 'number' || !Number.isSafeInteger(s.opening) || typeof s.start !== 'string' || !isIso(s.start)) return null;
  const months = typeof s.months === 'number' && s.months >= 1 && s.months <= 36 ? Math.floor(s.months) : 12;
  if (!Array.isArray(v.items)) return null;
  const items: Item[] = [];
  v.items.slice(0, 500).forEach((raw, i) => {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r !== 'object') return;
    if (typeof r.name !== 'string' || (r.kind !== 'in' && r.kind !== 'out')) return;
    if (typeof r.amountCents !== 'number' || !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0) return;
    if (typeof r.every !== 'string' || !EVERY.includes(r.every as Every)) return;
    if (typeof r.start !== 'string' || !isIso(r.start)) return;
    const end = typeof r.end === 'string' && isIso(r.end) ? r.end : '';
    items.push({ id: typeof r.id === 'string' ? r.id : `i${i}`, name: r.name.slice(0, 80), kind: r.kind, amountCents: r.amountCents, every: r.every as Every, start: r.start, end, enabled: r.enabled !== false });
  });
  return { settings: { opening: s.opening, start: s.start, months }, items };
}

function csvCell(v: string | number): string {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function forecastCsv(rows: { date: string; name: string; cents: number; balance: number }[]): string {
  const lines = [['date', 'item', 'amount', 'balance'].join(',')];
  for (const r of rows) lines.push([r.date, csvCell(r.name), (r.cents / 100).toFixed(2), (r.balance / 100).toFixed(2)].join(','));
  return lines.join('\r\n') + '\r\n';
}
