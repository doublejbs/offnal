import { describe, expect, it } from 'vitest';

import { remapDraftMonth } from '@/domain/DraftMonthRemapper';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { listDates } from '@/domain/YearMonth';

const buildEntries = (yearMonth: string): ShiftEntry[] =>
  listDates(yearMonth).map((date, index) => ({
    date,
    code: index % 2 === 0 ? 'D' : 'N',
    reviewReasons: [],
    confirmed: true,
  }));

describe('DraftMonthRemapper', () => {
  it('moves entries by day number', () => {
    const result = remapDraftMonth(buildEntries('2026-10'), '2026-10', '2026-12');

    expect(result).toHaveLength(31);
    expect(result[0]).toEqual({ date: '2026-12-01', code: 'D', reviewReasons: [], confirmed: true });
    expect(result[30]).toEqual({ date: '2026-12-31', code: 'D', reviewReasons: [], confirmed: true });
  });

  it('drops days that do not exist in the target month', () => {
    const result = remapDraftMonth(buildEntries('2026-10'), '2026-10', '2026-11');

    expect(result).toHaveLength(30);
    expect(result.at(-1)?.date).toBe('2026-11-30');
  });

  it('adds new days as missing', () => {
    const result = remapDraftMonth(buildEntries('2026-02'), '2026-02', '2026-03');

    expect(result).toHaveLength(31);
    expect(result[28]).toEqual({
      date: '2026-03-29',
      code: null,
      reviewReasons: [ShiftReviewReason.MISSING_DATE],
      confirmed: false,
    });
    expect(result[27]?.code).toBe('N');
  });

  it('keeps review reasons of moved entries', () => {
    const entries = buildEntries('2026-10');

    entries[4] = {
      ...entries[4]!,
      code: null,
      reviewReasons: [ShiftReviewReason.UNREADABLE],
      confirmed: false,
    };

    const result = remapDraftMonth(entries, '2026-10', '2026-11');

    expect(result[4]).toEqual({
      date: '2026-11-05',
      code: null,
      reviewReasons: [ShiftReviewReason.UNREADABLE],
      confirmed: false,
    });
  });

  it('ignores entries outside the source month', () => {
    const entries = [
      ...buildEntries('2026-10'),
      { date: '2026-09-15', code: 'OFF', reviewReasons: [], confirmed: true },
    ];
    const result = remapDraftMonth(entries, '2026-10', '2026-11');

    expect(result[14]?.code).toBe('D');
  });
});
