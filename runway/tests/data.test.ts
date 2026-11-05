import { describe, expect, it } from 'vitest';
import { emptyState, exampleState, forecastCsv, readState } from '../src/domain/data';
import { forecast } from '../src/domain/forecast';
import { centsToInput, formatMoney, parseMoney } from '../src/domain/money';

describe('money', () => {
  it('parses typed amounts into cents and rejects nonsense', () => {
    expect(parseMoney('1,250.50')).toBe(125050);
    expect(parseMoney('$12')).toBe(1200);
    expect(parseMoney('0.5')).toBe(50);
    expect(parseMoney('-3.20')).toBe(-320);
    for (const bad of ['', 'abc', '1.234', '1e3', '--1', '1,2,3.', '12 34']) expect(parseMoney(bad), bad).toBeNull();
  });
  it('formats with a real minus sign and thousands separators', () => {
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
    expect(formatMoney(-5)).toBe('−$0.05');
    expect(formatMoney(5, { sign: true })).toBe('+$0.05');
    expect(centsToInput(-1205)).toBe('-12.05');
    expect(formatMoney(123450, { whole: true })).toBe('$1,235');
    expect(formatMoney(-49, { whole: true })).toBe('$0');
  });
});

describe('state', () => {
  it('builds an example with a story to tell: the new van pushes it below zero', () => {
    const state = exampleState('2026-11-05');
    expect(state.settings.start).toBe('2026-11-01');
    const f = forecast(state.items, state.settings);
    expect(f.events.length).toBeGreaterThan(40);
    expect(f.runsOutOn).not.toBeNull();
  });
  it('round-trips through JSON', () => {
    const state = exampleState('2026-11-05');
    expect(readState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it('drops bad items instead of trusting them, and rejects a bad document', () => {
    const state = readState({ settings: { opening: 100, start: '2026-01-01', months: 99 }, items: [
      { id: 'a', name: 'ok', kind: 'in', amountCents: 5, every: 'week', start: '2026-01-01', end: '', enabled: true },
      { id: 'b', name: 'neg', kind: 'out', amountCents: -5, every: 'week', start: '2026-01-01' },
      { id: 'c', name: 'frac', kind: 'out', amountCents: 1.5, every: 'week', start: '2026-01-01' },
      { id: 'd', name: 'date', kind: 'out', amountCents: 5, every: 'week', start: '2026-02-30' },
      { id: 'e', name: 'kind', kind: 'sideways', amountCents: 5, every: 'week', start: '2026-01-01' },
      null,
    ] });
    expect(state?.items.map((i) => i.id)).toEqual(['a']);
    expect(state?.settings.months).toBe(12);
    expect(readState(null)).toBeNull();
    expect(readState({ settings: { opening: 1.5, start: '2026-01-01' }, items: [] })).toBeNull();
    expect(readState({ settings: { opening: 1, start: '2026-01-01' }, items: 'x' })).toBeNull();
  });
  it('starts empty on the first of the month', () => {
    expect(emptyState('2026-11-05').settings.start).toBe('2026-11-01');
  });
  it('writes a CSV with quoted names and neutralised formulas', () => {
    const csv = forecastCsv([{ date: '2026-01-01', name: '=HYPERLINK("x")', cents: -1250, balance: 98750 }, { date: '2026-01-02', name: 'Rent, shop', cents: 100, balance: 98850 }]);
    expect(csv.split('\r\n')[1]).toBe(`2026-01-01,"'=HYPERLINK(""x"")",-12.50,987.50`);
    expect(csv.split('\r\n')[2]).toBe('2026-01-02,"Rent, shop",1.00,988.50');
  });
});
