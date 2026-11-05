/** Dates are plain 'YYYY-MM-DD' strings. All arithmetic is done in UTC so time zones and DST never shift a day. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtc(value: string): number {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return fromUtc(toUtc(value) + days * 86_400_000);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function monthKey(value: string): string {
  return value.slice(0, 7);
}

/** The first day of the month `offset` months away from the month of `value`. */
export function addMonths(value: string, offset: number): string {
  const [y, m] = value.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + offset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Today in the viewer's local time zone (the only place the real clock is read). */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
