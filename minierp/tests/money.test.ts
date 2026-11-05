import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, divRound, isIsoDate, lineAmounts, parseMoney, sumAmounts } from '../src/domain';

describe('money', () => {
  it('rounds half up, in integers', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 2)).toBe(2);
    expect(divRound(1, 3)).toBe(0);
    expect(divRound(2, 3)).toBe(1);
    expect(divRound(-5, 2)).toBe(-3);
  });

  it('calculates tax per line and rounds each line', () => {
    // 3 x 0.33 at 15 % = 0.99 net, tax 0.1485 -> 0.15
    expect(lineAmounts(3, 33, 1500)).toEqual({ net: 99, tax: 15, gross: 114 });
    // 1 x 0.10 at 5 % = 0.005 -> rounds half up to 0.01
    expect(lineAmounts(1, 10, 500).tax).toBe(1);
    expect(lineAmounts(10, 1000, 0)).toEqual({ net: 10000, tax: 0, gross: 10000 });
  });

  it('rounds per line, so the printed lines always add up to the printed total', () => {
    const lines = [lineAmounts(1, 10, 500), lineAmounts(1, 10, 500), lineAmounts(1, 10, 500)];
    // each line's tax is 1 cent; rounding the sum instead would give 2 cents
    expect(sumAmounts(lines).tax).toBe(3);
  });

  it('parses typed amounts into cents and rejects nonsense', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('1,250.75')).toBe(125075);
    expect(parseMoney('٣٫٥')).toBe(350);
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
});

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-2-3')).toBe(false);
  });

  it('adds days and months across boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-03-01', '2026-03-31')).toBe(30);
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-01');
    expect(addMonths('2026-11-05', 3)).toBe('2027-02-01');
  });
});
