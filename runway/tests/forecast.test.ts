import { describe, expect, it } from 'vitest';
import { forecast, occurrences, type Item } from '../src/domain/forecast';

const item = (over: Partial<Item>): Item => ({ id: 'x', name: 'x', kind: 'out', amountCents: 10000, every: 'month', start: '2026-01-01', end: '', enabled: true, ...over });

describe('occurrences', () => {
  it('repeats weekly', () => {
    expect(occurrences(item({ every: 'week', start: '2026-01-05' }), '2026-01-01', '2026-01-31')).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });
  it('keeps the 31st as the anchor across short months', () => {
    expect(occurrences(item({ start: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('happens once for a one-off, only if inside the range', () => {
    expect(occurrences(item({ every: 'once', start: '2026-03-10' }), '2026-01-01', '2026-12-31')).toEqual(['2026-03-10']);
    expect(occurrences(item({ every: 'once', start: '2026-03-10' }), '2026-04-01', '2026-12-31')).toEqual([]);
  });
  it('starts counting from the item start even when the range starts later', () => {
    expect(occurrences(item({ start: '2026-01-15' }), '2026-03-01', '2026-05-31')).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
  });
  it('stops at the end date, inclusive', () => {
    expect(occurrences(item({ start: '2026-01-10', end: '2026-03-10' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });
  it('repeats yearly', () => {
    expect(occurrences(item({ every: 'year', start: '2025-06-01' }), '2026-01-01', '2028-12-31')).toEqual(['2026-06-01', '2027-06-01', '2028-06-01']);
  });
  it('returns nothing for invalid dates instead of hanging', () => {
    expect(occurrences(item({ start: 'soon' }), '2026-01-01', '2026-12-31')).toEqual([]);
  });
});

describe('forecast', () => {
  const settings = { opening: 100000, start: '2026-01-01', months: 6 };

  it('keeps a running balance', () => {
    const f = forecast([item({ kind: 'in', amountCents: 50000, start: '2026-01-01' }), item({ amountCents: 30000, start: '2026-01-15' })], { ...settings, months: 2 });
    expect(f.events.map((e) => e.balance)).toEqual([150000, 120000, 170000, 140000]);
    expect(f.closing).toBe(140000);
  });
  it('finds the lowest point and the date the money runs out', () => {
    const f = forecast([item({ amountCents: 40000, start: '2026-01-05' })], settings);
    expect(f.events.map((e) => e.balance)).toEqual([60000, 20000, -20000, -60000, -100000, -140000]);
    expect(f.runsOutOn).toBe('2026-03-05');
    expect(f.lowest).toEqual({ date: '2026-06-05', balance: -140000 });
  });
  it('reports no run-out when the balance stays positive', () => {
    const f = forecast([item({ kind: 'in', amountCents: 1000 })], settings);
    expect(f.runsOutOn).toBeNull();
    expect(f.lowest).toEqual({ date: '2026-01-01', balance: 100000 });
  });
  it('is already out of money when it opens negative', () => {
    expect(forecast([], { ...settings, opening: -500 }).runsOutOn).toBe('2026-01-01');
  });
  it('applies money in before money out on the same day', () => {
    const f = forecast([item({ amountCents: 5000, start: '2026-01-10' }), item({ kind: 'in', amountCents: 5000, start: '2026-01-10' })], { opening: 0, start: '2026-01-01', months: 1 });
    expect(f.runsOutOn).toBeNull();
    expect(f.lowest.balance).toBe(0);
  });
  it('ignores items that are switched off or have no amount', () => {
    const f = forecast([item({ enabled: false }), item({ amountCents: 0 })], settings);
    expect(f.events).toEqual([]);
    expect(f.closing).toBe(100000);
  });
  it('sums each month and the monthly closings chain together', () => {
    const f = forecast([item({ kind: 'in', amountCents: 70000, start: '2026-01-02' }), item({ amountCents: 20000, start: '2026-01-20' }), item({ every: 'once', amountCents: 5000, start: '2026-03-03' })], { ...settings, months: 3 });
    expect(f.months.map((m) => [m.month, m.in, m.out, m.closing])).toEqual([
      ['2026-01', 70000, 20000, 150000],
      ['2026-02', 70000, 20000, 200000],
      ['2026-03', 70000, 25000, 245000],
    ]);
    expect(f.months[2]?.closing).toBe(f.closing);
  });
  it('covers a horizon that does not start on the 1st without double counting', () => {
    const f = forecast([item({ amountCents: 1000, start: '2026-01-20' })], { opening: 0, start: '2026-01-15', months: 2 });
    expect(f.end).toBe('2026-03-14');
    expect(f.months.map((m) => m.out)).toEqual([1000, 1000]);
    expect(f.events.length).toBe(2);
  });
  it('never loses a cent: opening + all events = closing', () => {
    const items = [item({ kind: 'in', amountCents: 123457, every: 'week', start: '2026-01-02' }), item({ amountCents: 9999, every: 'month', start: '2026-01-31' })];
    const f = forecast(items, { opening: 777, start: '2026-01-01', months: 12 });
    expect(777 + f.events.reduce((s, e) => s + e.cents, 0)).toBe(f.closing);
    expect(f.months.reduce((s, m) => s + m.in - m.out, 777)).toBe(f.closing);
  });
});
