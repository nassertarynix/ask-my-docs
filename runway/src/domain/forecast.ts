import { addDays, addMonths, isIso, monthKey } from './dates';

export type Every = 'once' | 'week' | 'month' | 'year';

export interface Item {
  id: string;
  name: string;
  /** `in` adds to the balance, `out` takes from it. */
  kind: 'in' | 'out';
  /** A positive whole number of cents. */
  amountCents: number;
  every: Every;
  /** The first date it happens. Later dates repeat from here. */
  start: string;
  /** The last date it may happen, inclusive; empty means it never stops. */
  end: string;
  /** Switch an item off to see what the forecast looks like without it. */
  enabled: boolean;
}

export interface Event { date: string; item: Item; cents: number }

/** Every date the item happens in [from, to], inclusive and in order. Capped so a bad range cannot hang the page. */
export function occurrences(item: Item, from: string, to: string): string[] {
  if (!isIso(item.start) || !isIso(from) || !isIso(to)) return [];
  const last = item.end && isIso(item.end) && item.end < to ? item.end : to;
  const dates: string[] = [];
  for (let n = 0; n < 5000; n++) {
    const date = item.every === 'once' ? item.start
      : item.every === 'week' ? addDays(item.start, 7 * n)
      : item.every === 'month' ? addMonths(item.start, n)
      : addMonths(item.start, 12 * n);
    if (date > last) break;
    if (date >= from) dates.push(date);
    if (item.every === 'once') break;
  }
  return dates;
}

export interface Settings { opening: number; start: string; months: number }

export interface MonthRow { month: string; in: number; out: number; closing: number }

export interface Forecast {
  events: (Event & { balance: number })[];
  months: MonthRow[];
  /** The lowest the balance gets, and the first date it does. */
  lowest: { date: string; balance: number };
  /** The first date the balance drops below zero, or null if it never does in the horizon. */
  runsOutOn: string | null;
  end: string;
  closing: number;
}

/**
 * Walk the events in date order and keep a running balance. On one day, money in is applied before money out:
 * that is a stated rule, because it decides whether a same-day payment counts as a dip below zero.
 */
export function forecast(items: Item[], settings: Settings): Forecast {
  const end = addDays(addMonths(settings.start, settings.months), -1);
  const events: Event[] = [];
  for (const item of items) {
    if (!item.enabled || !(item.amountCents > 0)) continue;
    for (const date of occurrences(item, settings.start, end)) events.push({ date, item, cents: item.kind === 'in' ? item.amountCents : -item.amountCents });
  }
  events.sort((a, b) => (a.date === b.date ? Math.sign(b.cents) - Math.sign(a.cents) : a.date < b.date ? -1 : 1));

  let balance = settings.opening;
  let lowest = { date: settings.start, balance };
  let runsOutOn: string | null = balance < 0 ? settings.start : null;
  const withBalance = events.map((event) => {
    balance += event.cents;
    if (balance < lowest.balance) lowest = { date: event.date, balance };
    if (balance < 0 && runsOutOn === null) runsOutOn = event.date;
    return { ...event, balance };
  });

  const months: MonthRow[] = [];
  let cursor = settings.start;
  for (let n = 0; n < settings.months; n++) {
    const key = monthKey(addMonths(cursor, 0));
    months.push({ month: key, in: 0, out: 0, closing: 0 });
    cursor = addMonths(settings.start, n + 1);
  }
  // A month row covers [start + n months, start + n+1 months - 1 day], so the horizon need not begin on the 1st.
  const bounds = months.map((_, n) => addDays(addMonths(settings.start, n + 1), -1));
  let running = settings.opening, i = 0;
  months.forEach((row, n) => {
    while (i < withBalance.length && (withBalance[i] as { date: string }).date <= (bounds[n] as string)) {
      const e = withBalance[i] as Event & { balance: number };
      if (e.cents > 0) row.in += e.cents; else row.out += -e.cents;
      running = e.balance;
      i++;
    }
    row.closing = running;
  });

  return { events: withBalance, months, lowest, runsOutOn, end, closing: balance };
}
