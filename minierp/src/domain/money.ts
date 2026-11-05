/**
 * Money is always an integer number of cents. Floating point is never used for amounts,
 * so 0.1 + 0.2 style errors cannot happen. Tax rates are integer basis points (1500 = 15 %).
 */
import { DomainError } from './errors';

export type Cents = number;

/** Divide and round half up (away from zero for positives), staying in integers. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('division by zero');
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

export interface LineAmounts {
  net: Cents;
  tax: Cents;
  gross: Cents;
}

/** Tax is rounded per line (half up), so printed lines always add up to the printed total. */
export function lineAmounts(qty: number, unitPrice: Cents, taxBps: number): LineAmounts {
  const net = qty * unitPrice;
  const tax = divRound(net * taxBps, 10_000);
  return { net, tax, gross: net + tax };
}

export function sumAmounts(lines: LineAmounts[]): LineAmounts {
  return lines.reduce(
    (total, line) => ({ net: total.net + line.net, tax: total.tax + line.tax, gross: total.gross + line.gross }),
    { net: 0, tax: 0, gross: 0 },
  );
}

/** Parse what a person types ("12", "12.5", "1,250.75") into cents. Returns null when it is not a valid amount. */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.replace(/[\s,]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function requireCents(value: number, field: string, { allowZero = true } = {}): Cents {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new DomainError('invalid_amount', { field });
  }
  return value;
}

export function requireQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DomainError('invalid_quantity');
  return value;
}

export function requireTaxBps(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new DomainError('invalid_amount', { field: 'tax' });
  return value;
}

export function formatMoney(cents: Cents, locale = 'en-US', currency = 'USD'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
}

/** "15 %" from 1500. */
export function formatPercent(bps: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);
}

/** The text shown in an amount field for a given number of cents: 1250 -> "12.50". */
export function centsToInput(cents: Cents): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** Parse a percentage typed by a person ("15", "7.5") into basis points. Null when invalid or above 100 %. */
export function parsePercentToBps(input: string): number | null {
  const cleaned = input.trim().replace(',', '.').replace('%', '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps <= 10_000 ? bps : null;
}
