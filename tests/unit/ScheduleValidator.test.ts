import { describe, expect, it } from 'vitest';

import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import {
  alignCellsToMonth,
  getPublishBlockers,
  hasExactDateSet,
  isValidCode,
  normalizeCode,
  normalizeExtraction,
  summarizeReview,
} from '@/domain/ScheduleValidator';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const DEFINITIONS: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
  { code: 'N', label: '나이트', startTime: '22:00', endTime: '07:00', endsNextDay: true, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
];

const buildCells = (days: number, code = 'D'): ExtractedCell[] =>
  Array.from({ length: days }, (_, index) => ({ day: index + 1, rawText: code, code, ambiguous: false }));

const buildExtraction = (cells: ExtractedCell[], definitions = DEFINITIONS): PersonExtraction => ({
  yearMonth: '2026-11',
  rowId: 'row-1',
  displayName: '김하루',
  definitions,
  cells,
});

const findEntry = (entries: ShiftEntry[], date: string): ShiftEntry => {
  const entry = entries.find((item) => item.date === date);

  if (!entry) {
    throw new Error(`missing ${date}`);
  }

  return entry;
};

describe('ScheduleValidator.normalizeExtraction', () => {
  it('produces exactly one confirmed entry per date for a clean extraction', () => {
    const result = normalizeExtraction(buildExtraction(buildCells(30)), '2026-11');

    expect(result.entries).toHaveLength(30);
    expect(result.entries.every((entry) => entry.confirmed && entry.reviewReasons.length === 0)).toBe(true);
    expect(result.entries.map((entry) => entry.date)).toEqual(
      Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`),
    );
    expect(result.definitions).toEqual(DEFINITIONS);
  });

  it('marks missing dates', () => {
    const cells = buildCells(30).filter((cell) => cell.day !== 5);
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');

    expect(findEntry(result.entries, '2026-11-05')).toEqual({
      date: '2026-11-05',
      code: null,
      reviewReasons: [ShiftReviewReason.MISSING_DATE],
      confirmed: false,
    });
  });

  it('marks duplicate days instead of keeping the first value', () => {
    const cells = [...buildCells(30), { day: 3, rawText: 'N', code: 'N', ambiguous: false }];
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');
    const entry = findEntry(result.entries, '2026-11-03');

    expect(entry.code).toBeNull();
    expect(entry.reviewReasons).toEqual([ShiftReviewReason.DUPLICATE_DATE]);
    expect(entry.confirmed).toBe(false);
    expect(result.entries).toHaveLength(30);
  });

  it('ignores days outside the month', () => {
    const cells = [
      ...buildCells(30),
      { day: 31, rawText: 'D', code: 'D', ambiguous: false },
      { day: 0, rawText: 'D', code: 'D', ambiguous: false },
      { day: 2.5, rawText: 'D', code: 'D', ambiguous: false },
    ];
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');

    expect(result.entries).toHaveLength(30);
    expect(result.entries.every((entry) => entry.confirmed)).toBe(true);
  });

  it('keeps blank, dash and suspicious cells as null and never guesses OFF', () => {
    const cells = buildCells(30);
    const replacements: Record<number, Partial<ExtractedCell>> = {
      1: { rawText: null, code: 'OFF' },
      2: { rawText: '', code: 'OFF' },
      3: { rawText: '-', code: 'OFF' },
      4: { rawText: '—', code: null },
      5: { rawText: '  ', code: 'OFF' },
      6: { rawText: '?', code: 'D' },
      7: { rawText: 'D', code: null },
    };
    const patched = cells.map((cell) => ({ ...cell, ...(replacements[cell.day] ?? {}) }));
    const result = normalizeExtraction(buildExtraction(patched), '2026-11');

    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      const entry = findEntry(result.entries, `2026-11-0${day}`);

      expect(entry.code).toBeNull();
      expect(entry.reviewReasons).toEqual([ShiftReviewReason.UNREADABLE]);
      expect(entry.confirmed).toBe(false);
    }
  });

  it('keeps ambiguous codes but requires review', () => {
    const cells = buildCells(30).map((cell) =>
      cell.day === 14 ? { day: 14, rawText: 'E?', code: 'D', ambiguous: true } : cell,
    );
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');
    const entry = findEntry(result.entries, '2026-11-14');

    expect(entry.code).toBe('D');
    expect(entry.reviewReasons).toEqual([ShiftReviewReason.AMBIGUOUS]);
    expect(entry.confirmed).toBe(false);
  });

  it('marks raw text with a doubt mark as ambiguous even when the provider did not', () => {
    const cells = buildCells(30).map((cell) => {
      if (cell.day === 3) {
        return { ...cell, rawText: 'D?', ambiguous: false };
      }

      if (cell.day === 4) {
        return { ...cell, rawText: '？D', ambiguous: false };
      }

      return cell;
    });
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');

    for (const date of ['2026-11-03', '2026-11-04']) {
      expect(findEntry(result.entries, date)).toEqual({
        date,
        code: 'D',
        reviewReasons: [ShiftReviewReason.AMBIGUOUS],
        confirmed: false,
      });
    }
  });

  it('treats codes longer than 12 characters as unreadable instead of truncating', () => {
    const cells = buildCells(30).map((cell) =>
      cell.day === 8 ? { ...cell, rawText: 'VERYLONGCODE13', code: 'VERYLONGCODE13' } : cell,
    );
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');

    expect(findEntry(result.entries, '2026-11-08')).toEqual({
      date: '2026-11-08',
      code: null,
      reviewReasons: [ShiftReviewReason.UNREADABLE],
      confirmed: false,
    });
    expect(result.definitions.some((definition) => definition.code.startsWith('VERYLONG'))).toBe(false);
  });

  it('uses the yearMonth argument and ignores the provider month', () => {
    const extraction = { ...buildExtraction(buildCells(31)), yearMonth: '2026-11' };
    const result = normalizeExtraction(extraction, '2026-12');

    expect(result.entries).toHaveLength(31);
    expect(result.entries[0]?.date).toBe('2026-12-01');
  });

  it('adds undefined codes to the definition list', () => {
    const cells = buildCells(30).map((cell) =>
      cell.day === 9 ? { day: 9, rawText: 'x-ed', code: ' ed ', ambiguous: false } : cell,
    );
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');
    const entry = findEntry(result.entries, '2026-11-09');

    expect(entry.code).toBe('ED');
    expect(entry.reviewReasons).toEqual([ShiftReviewReason.UNDEFINED_CODE]);
    expect(entry.confirmed).toBe(false);
    expect(result.definitions).toContainEqual({
      code: 'ED',
      label: 'ED',
      startTime: null,
      endTime: null,
      endsNextDay: null,
      isOff: false,
    });
    expect(result.definitions.filter((definition) => definition.code === 'ED')).toHaveLength(1);
  });

  it('flags every occurrence of an undefined code but adds its definition once', () => {
    const cells = buildCells(30).map((cell) =>
      cell.day === 9 || cell.day === 10 ? { ...cell, rawText: 'ED', code: 'ED' } : cell,
    );
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');

    expect(findEntry(result.entries, '2026-11-09').reviewReasons).toEqual([ShiftReviewReason.UNDEFINED_CODE]);
    expect(findEntry(result.entries, '2026-11-10').reviewReasons).toEqual([ShiftReviewReason.UNDEFINED_CODE]);
    expect(result.definitions.filter((definition) => definition.code === 'ED')).toHaveLength(1);
  });

  it('accepts a single-letter X code as readable', () => {
    const definitions = [...DEFINITIONS, { ...DEFINITIONS[2]!, code: 'X', label: '연차' }];
    const cells = buildCells(30).map((cell) =>
      cell.day === 1 ? { ...cell, rawText: 'X', code: 'X' } : cell,
    );
    const result = normalizeExtraction(buildExtraction(cells, definitions), '2026-11');

    expect(findEntry(result.entries, '2026-11-01')).toMatchObject({ code: 'X', confirmed: true });
  });

  it('normalizes codes: trim, upper case, Korean kept, max 12 chars', () => {
    expect(normalizeCode('  off ')).toBe('OFF');
    expect(normalizeCode('연차')).toBe('연차');
    expect(normalizeCode('abcdefghijklmnop')).toBe('ABCDEFGHIJKLMNOP');
    expect(isValidCode('ABCDEFGHIJKL')).toBe(true);
    expect(isValidCode('D')).toBe(true);
    expect(isValidCode('')).toBe(false);
    expect(isValidCode('ABCDEFGHIJKLM')).toBe(false);
    expect(isValidCode('d')).toBe(false);
  });

  it('normalizes definition codes from the extraction', () => {
    const definitions = [{ ...DEFINITIONS[0]!, code: ' d ' }, DEFINITIONS[1]!, DEFINITIONS[2]!];
    const result = normalizeExtraction(buildExtraction(buildCells(30), definitions), '2026-11');

    expect(result.definitions.map((definition) => definition.code)).toEqual(['D', 'N', 'OFF']);
    expect(result.entries.every((entry) => entry.confirmed)).toBe(true);
  });

  it('returns source cells for every date with raw text', () => {
    const cells = buildCells(30).filter((cell) => cell.day !== 2);
    const result = normalizeExtraction(buildExtraction(cells), '2026-11');

    expect(result.sourceCells).toHaveLength(30);
    expect(result.sourceCells[0]).toEqual({ date: '2026-11-01', rawText: 'D' });
    expect(result.sourceCells[1]).toEqual({ date: '2026-11-02', rawText: null });
  });
});

describe('ScheduleValidator.getPublishBlockers', () => {
  const buildEntries = (code: string | null = 'D'): ShiftEntry[] =>
    Array.from({ length: 30 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      code,
      reviewReasons: [],
      confirmed: true,
    }));

  it('returns no blockers for a complete schedule', () => {
    expect(getPublishBlockers(buildEntries(), DEFINITIONS)).toEqual([]);
  });

  it('blocks unconfirmed or null dates', () => {
    const entries = buildEntries();

    entries[0] = { ...entries[0]!, code: null, confirmed: true };
    entries[1] = { ...entries[1]!, confirmed: false };

    expect(getPublishBlockers(entries, DEFINITIONS)).toEqual([
      { reason: PublishBlockReason.UNCONFIRMED_DATES, dates: ['2026-11-01', '2026-11-02'] },
    ]);
  });

  it('blocks used non-off codes with missing times', () => {
    const definitions = [
      ...DEFINITIONS,
      { code: 'E', label: '이브닝', startTime: '15:00', endTime: null, endsNextDay: false, isOff: false },
      { code: 'X', label: '미사용', startTime: null, endTime: null, endsNextDay: null, isOff: false },
    ];
    const entries = buildEntries();

    entries[3] = { ...entries[3]!, code: 'E' };

    expect(getPublishBlockers(entries, definitions)).toEqual([
      { reason: PublishBlockReason.MISSING_TIMES, codes: ['E'] },
    ]);
  });

  it('blocks when endsNextDay is null or times are inconsistent', () => {
    const definitions = [
      { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: null, isOff: false },
      { code: 'N', label: '나이트', startTime: '22:00', endTime: '07:00', endsNextDay: false, isOff: false },
    ];
    const entries = buildEntries();

    entries[0] = { ...entries[0]!, code: 'N' };

    expect(getPublishBlockers(entries, definitions)).toEqual([
      { reason: PublishBlockReason.MISSING_TIMES, codes: ['D', 'N'] },
    ]);
  });

  it('blocks overnight shifts longer than 24 hours', () => {
    const definitions = [
      { code: 'D', label: '당직', startTime: '09:00', endTime: '18:00', endsNextDay: true, isOff: false },
    ];

    expect(getPublishBlockers(buildEntries(), definitions)).toEqual([
      { reason: PublishBlockReason.MISSING_TIMES, codes: ['D'] },
    ]);
  });

  it('does not require times for off codes', () => {
    const entries = buildEntries('OFF');

    expect(getPublishBlockers(entries, DEFINITIONS)).toEqual([]);
  });

  it('blocks undefined codes', () => {
    const entries = buildEntries();

    entries[5] = { ...entries[5]!, code: 'Q' };

    expect(getPublishBlockers(entries, DEFINITIONS)).toEqual([
      { reason: PublishBlockReason.UNDEFINED_CODES, codes: ['Q'] },
    ]);
  });

  it('reports all three blockers in a stable order', () => {
    const definitions = [
      ...DEFINITIONS,
      { code: 'E', label: '이브닝', startTime: null, endTime: null, endsNextDay: null, isOff: false },
    ];
    const entries = buildEntries();

    entries[0] = { ...entries[0]!, code: null, confirmed: false };
    entries[1] = { ...entries[1]!, code: 'E' };
    entries[2] = { ...entries[2]!, code: 'Z' };

    expect(getPublishBlockers(entries, definitions).map((blocker) => blocker.reason)).toEqual([
      PublishBlockReason.UNCONFIRMED_DATES,
      PublishBlockReason.MISSING_TIMES,
      PublishBlockReason.UNDEFINED_CODES,
    ]);
  });
});

describe('ScheduleValidator.summarizeReview', () => {
  it('counts dates needing review', () => {
    const entries: ShiftEntry[] = [
      { date: '2026-11-01', code: 'D', reviewReasons: [], confirmed: true },
      { date: '2026-11-02', code: null, reviewReasons: [ShiftReviewReason.UNREADABLE], confirmed: false },
      { date: '2026-11-03', code: 'D', reviewReasons: [ShiftReviewReason.AMBIGUOUS], confirmed: false },
      { date: '2026-11-04', code: null, reviewReasons: [], confirmed: true },
    ];

    expect(summarizeReview(entries)).toEqual({
      count: 3,
      dates: ['2026-11-02', '2026-11-03', '2026-11-04'],
    });
  });
});

describe('ScheduleValidator.hasExactDateSet', () => {
  it('accepts exactly one entry per date of the month', () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      code: 'D',
      reviewReasons: [],
      confirmed: true,
    }));

    expect(hasExactDateSet(entries, '2026-11')).toBe(true);
    expect(hasExactDateSet(entries.slice(1), '2026-11')).toBe(false);
    expect(hasExactDateSet([...entries.slice(1), entries[1]!], '2026-11')).toBe(false);
    expect(hasExactDateSet(entries, '2026-10')).toBe(false);
  });
});

describe('ScheduleValidator.alignCellsToMonth', () => {
  const cell = (day: number, code: string | null): ExtractedCell => ({
    day,
    rawText: code,
    code,
    ambiguous: false,
  });

  it('numbers strip cells by position when the count equals the days of the month', () => {
    // The model mislabeled day numbers but returned exactly 30 cells in order.
    const cells = Array.from({ length: 30 }, (_, index) => cell(index === 4 ? 4 : index + 1, 'D'));
    const aligned = alignCellsToMonth(cells, '2026-11');

    expect(aligned.countMatches).toBe(true);
    expect(aligned.cells.map((item) => item.day)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(aligned.cells.every((item) => !item.ambiguous)).toBe(true);
  });

  it('leaves missing trailing days empty (MISSING_DATE) and flags the rest for review when too short', () => {
    const aligned = alignCellsToMonth(buildCells(28), '2026-11');

    expect(aligned.countMatches).toBe(false);
    expect(aligned.cells).toHaveLength(28);
    expect(aligned.cells.every((item) => item.ambiguous)).toBe(true);

    const schedule = normalizeExtraction(buildExtraction(aligned.cells), '2026-11');

    expect(findEntry(schedule.entries, '2026-11-29')).toMatchObject({
      code: null,
      reviewReasons: [ShiftReviewReason.MISSING_DATE],
    });
    expect(findEntry(schedule.entries, '2026-11-30').code).toBeNull();
    expect(findEntry(schedule.entries, '2026-11-01')).toMatchObject({
      code: 'D',
      reviewReasons: [ShiftReviewReason.AMBIGUOUS],
      confirmed: false,
    });
  });

  it('truncates extra cells and never invents codes', () => {
    const cells = [...buildCells(30), cell(31, 'N'), cell(32, 'E')];
    const aligned = alignCellsToMonth(cells, '2026-11');

    expect(aligned.countMatches).toBe(false);
    expect(aligned.cells).toHaveLength(30);
    expect(aligned.cells.map((item) => item.code)).toEqual(Array.from({ length: 30 }, () => 'D'));

    const nullCells = alignCellsToMonth([cell(1, null)], '2026-11');

    expect(nullCells.cells).toEqual([{ day: 1, rawText: null, code: null, ambiguous: true }]);
  });
});
