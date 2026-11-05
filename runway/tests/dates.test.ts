import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysInMonth, isIso, parseIso } from '../src/domain/dates';

describe('dates', () => {
  it('knows leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
  it('accepts only real calendar dates', () => {
    expect(isIso('2026-02-29')).toBe(false);
    expect(isIso('2024-02-29')).toBe(true);
    expect(isIso('2026-13-01')).toBe(false);
    expect(isIso('2026-1-1')).toBe(false);
    expect(parseIso('hello')).toBeNull();
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('clamps the day when adding months, keeping the anchor day for later months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', -3)).toBe('2025-12-10');
  });
  it('moves a leap day to Feb 28 in common years', () => {
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2024-02-29', 48)).toBe('2028-02-29');
  });
});
