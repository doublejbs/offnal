import { describe, expect, it } from 'vitest';

import {
  addDaysToDate,
  currentYearMonthInSeoul,
  dayOfDate,
  daysInMonth,
  formatYearMonthLabel,
  isValidDate,
  isValidYearMonth,
  listDates,
  nextYearMonth,
  parseYearMonth,
  toDateString,
  weekdayOf,
} from '@/domain/YearMonth';

describe('YearMonth', () => {
  it('parses valid year-month strings', () => {
    expect(parseYearMonth('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseYearMonth('2000-01')).toEqual({ year: 2000, month: 1 });
    expect(parseYearMonth('2100-12')).toEqual({ year: 2100, month: 12 });
  });

  it('rejects invalid formats and ranges', () => {
    for (const value of [
      '2026-13',
      '2026-00',
      '2026-1',
      '26-10',
      '1999-12',
      '2101-01',
      '2026/10',
      '',
      ' 2026-10',
      '2026-10-01',
    ]) {
      expect(parseYearMonth(value)).toBeNull();
      expect(isValidYearMonth(value)).toBe(false);
    }
  });

  it('computes days in month including leap years', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-11')).toBe(30);
  });

  it('throws for invalid year-month in daysInMonth', () => {
    expect(() => daysInMonth('2026-13')).toThrow();
  });

  it('lists every date of the month', () => {
    const dates = listDates('2028-02');

    expect(dates).toHaveLength(29);
    expect(dates[0]).toBe('2028-02-01');
    expect(dates[28]).toBe('2028-02-29');
  });

  it('returns weekday with 0 = Sunday', () => {
    expect(weekdayOf('2026-10-01')).toBe(4);
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2028-02-29')).toBe(2);
  });

  it('returns current year-month in Seoul', () => {
    expect(currentYearMonthInSeoul(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11');
    expect(currentYearMonthInSeoul(new Date('2026-10-31T14:59:59Z'))).toBe('2026-10');
    expect(currentYearMonthInSeoul(new Date('2026-12-31T15:30:00Z'))).toBe('2027-01');
  });

  it('computes next year-month across year end', () => {
    expect(nextYearMonth('2026-10')).toBe('2026-11');
    expect(nextYearMonth('2026-12')).toBe('2027-01');
  });

  it('validates dates and helpers', () => {
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-10-32')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
    expect(dayOfDate('2026-10-07')).toBe(7);
    expect(toDateString(2026, 1, 5)).toBe('2026-01-05');
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(formatYearMonthLabel('2026-03')).toBe('2026년 3월');
    expect(addDaysToDate('2100-12-31', 1)).toBe('2101-01-01');
  });
});
