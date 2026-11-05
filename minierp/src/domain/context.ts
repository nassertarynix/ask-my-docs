import { Db } from './db';
import { isIsoDate, localToday } from './dates';
import { DomainError } from './errors';

/**
 * Everything the domain functions need: the database and a clock.
 * The clock is injected so tests (and the demo-data generator) can say what "today" is
 * instead of depending on the real date.
 */
export interface Ctx {
  db: Db;
  today: () => string;
}

export function makeCtx(db: Db, today: () => string = () => localToday()): Ctx {
  return { db, today };
}

export function requireDate(value: string): string {
  if (!isIsoDate(value)) throw new DomainError('invalid_date', { value });
  return value;
}

export function requireText(value: string, code: 'invalid_name' = 'invalid_name'): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainError(code);
  return trimmed;
}

/** Next document number such as INV-2026-0007. Numbers restart each year and are never reused. */
export function nextNumber(ctx: Ctx, prefix: string, date: string): string {
  const year = Number(date.slice(0, 4));
  ctx.db.run(
    `INSERT INTO sequences (name, year, last) VALUES (?, ?, 1)
     ON CONFLICT(name, year) DO UPDATE SET last = last + 1`,
    [prefix, year],
  );
  const row = ctx.db.get<{ last: number }>('SELECT last FROM sequences WHERE name = ? AND year = ?', [prefix, year]);
  return `${prefix}-${year}-${String(row?.last ?? 1).padStart(4, '0')}`;
}

export function getSetting(ctx: Ctx, key: string, fallback: string): string {
  return ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? fallback;
}

export function setSetting(ctx: Ctx, key: string, value: string): void {
  ctx.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
