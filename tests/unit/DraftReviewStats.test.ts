import { describe, expect, it } from 'vitest';

import { countEditedDays, countReviewEntries, countUnresolvedEntries } from '@/domain/DraftReviewStats';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const entry = (date: string, code: string | null, reviewReasons: ShiftReviewReason[] = []): ShiftEntry => ({
  date,
  code,
  reviewReasons,
  confirmed: false,
});

describe('draft review stats', () => {
  it('counts review cells (no code or ambiguous) and unresolved cells (no code)', () => {
    const entries = [
      entry('2026-10-01', 'D'),
      entry('2026-10-02', null, [ShiftReviewReason.UNREADABLE]),
      entry('2026-10-03', 'E', [ShiftReviewReason.AMBIGUOUS]),
      entry('2026-10-04', 'X', [ShiftReviewReason.UNDEFINED_CODE]),
    ];

    expect(countReviewEntries(entries)).toBe(2);
    expect(countUnresolvedEntries(entries)).toBe(1);
  });

  it('counts changed days against the initial AI draft by day number', () => {
    const initial = [entry('2026-10-01', 'D'), entry('2026-10-02', null), entry('2026-10-03', 'E')];
    const final = [entry('2026-10-01', 'D'), entry('2026-10-02', 'OFF'), entry('2026-10-03', 'N')];

    expect(countEditedDays(initial, final)).toBe(2);
    expect(countEditedDays(initial, initial)).toBe(0);
  });

  it('compares by day number after a month change and counts new days as edited when filled', () => {
    const initial = [entry('2026-09-01', 'D'), entry('2026-09-02', 'E')];
    const final = [entry('2026-10-01', 'D'), entry('2026-10-02', 'E'), entry('2026-10-03', 'OFF')];

    expect(countEditedDays(initial, final)).toBe(1);
  });
});
