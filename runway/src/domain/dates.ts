/** Calendar dates as `YYYY-MM-DD` strings. All arithmetic is done on year/month/day numbers, never on local-time Date objects, so time zones and daylight saving cannot move a date. */
export interface Ymd { y: number; m: number; d: number }

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseIso(s: string): Ymd | null {
  const match = ISO.exec(s);
  if (!match) return null;
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isIso(s: string): boolean {
  return parseIso(s) !== null;
}

export function toIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function must(s: string): Ymd {
  const v = parseIso(s);
  if (!v) throw new Error(`Not a date: ${s}`);
  return v;
}

export function addDays(s: string, days: number): string {
  const { y, m, d } = must(s);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toIso({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Add whole months to an anchor date. The day of the month is clamped, so the 31st becomes the 28th, 29th or 30th when the month is shorter. The anchor day is kept for later months (Jan 31 -> Feb 28 -> Mar 31). */
export function addMonths(s: string, months: number): string {
  const { y, m, d } = must(s);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12), nm = (index % 12 + 12) % 12 + 1;
  return toIso({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

export function localToday(now: Date = new Date()): string {
  return toIso({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}
