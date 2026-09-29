import { describe, expect, it } from 'vitest';

import {
  buildMonthWeeks,
  findAdjacentMonth,
  formatDayLabel,
  formatMonthDay,
  WEEKDAY_LABELS,
} from '@/client/MonthLayout';

describe('MonthLayout', () => {
  it('starts the month on its weekday with leading blanks (2026-10 starts on Thursday)', () => {
    const weeks = buildMonthWeeks('2026-10');

    expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[4]).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });

  it('pads the last week with trailing blanks', () => {
    const weeks = buildMonthWeeks('2026-11');

    expect(weeks[0]?.[0]).toBe('2026-11-01');
    expect(weeks.at(-1)).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null]);
  });

  it('uses six rows when the month needs them', () => {
    // 2026-08-01 is a Saturday: 6 blanks + 31 days = 37 cells → 6 weeks.
    const weeks = buildMonthWeeks('2026-08');

    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.filter((date) => date === null)).toHaveLength(6);
    expect(weeks.flat().filter((date) => date !== null)).toHaveLength(31);
  });

  it('handles a February that fits in exactly four weeks', () => {
    // 2026-02-01 is a Sunday and 2026 is not a leap year.
    expect(buildMonthWeeks('2026-02')).toHaveLength(4);
    expect(
      buildMonthWeeks('2028-02')
        .flat()
        .filter((date) => date !== null),
    ).toHaveLength(29);
  });

  it('formats Korean weekday and date labels', () => {
    expect(WEEKDAY_LABELS).toEqual(['일', '월', '화', '수', '목', '금', '토']);
    expect(formatMonthDay('2026-10-14')).toBe('10월 14일');
    expect(formatDayLabel('2026-10-14')).toBe('10월 14일 (수)');
  });

  it('finds the previous and next month among published months only', () => {
    const months = ['2026-08', '2026-10', '2027-01'];

    expect(findAdjacentMonth(months, '2026-10', -1)).toBe('2026-08');
    expect(findAdjacentMonth(months, '2026-10', 1)).toBe('2027-01');
    expect(findAdjacentMonth(months, '2026-08', -1)).toBeNull();
    expect(findAdjacentMonth(months, '2027-01', 1)).toBeNull();
    expect(findAdjacentMonth(months, '2026-09', 1)).toBe('2026-10');
  });
});
