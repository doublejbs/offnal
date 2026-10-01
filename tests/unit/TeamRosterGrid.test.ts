import { describe, expect, it } from 'vitest';

import {
  collectRosterBlockers,
  countShiftsByDate,
  findBlockerDate,
  findGridTarget,
  isLegendBlocker,
  listRenameCandidates,
} from '@/client/TeamRosterGrid';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { listDates } from '@/domain/YearMonth';

import { buildEntries, buildRow, DEFINITIONS, YEAR_MONTH } from './support/RosterUiFixture';

describe('TeamRosterGrid', () => {
  it('counts D/E/N per date by tone', () => {
    const dates = listDates(YEAR_MONTH);
    const counts = countShiftsByDate(
      [
        { entries: buildEntries('D') },
        {
          entries: buildEntries('N', {
            1: { date: '2026-11-01', code: 'E', reviewReasons: [], confirmed: true },
          }),
        },
        { entries: buildEntries('OFF') },
      ],
      dates,
      DEFINITIONS,
    );

    expect(counts.get('2026-11-01')).toEqual({ day: 1, evening: 1, night: 0 });
    expect(counts.get('2026-11-02')).toEqual({ day: 1, evening: 0, night: 1 });
  });

  it('moves roving focus inside the grid and stops at the edges', () => {
    expect(findGridTarget('ArrowRight', { row: 0, column: 0 }, 3, 30)).toEqual({ row: 0, column: 1 });
    expect(findGridTarget('ArrowDown', { row: 2, column: 4 }, 3, 30)).toBeNull();
    expect(findGridTarget('ArrowLeft', { row: 1, column: 0 }, 3, 30)).toBeNull();
    expect(findGridTarget('End', { row: 1, column: 3 }, 3, 30)).toEqual({ row: 1, column: 29 });
    expect(findGridTarget('Home', { row: 1, column: 3 }, 3, 30)).toEqual({ row: 1, column: 0 });
    expect(findGridTarget('a', { row: 1, column: 3 }, 3, 30)).toBeNull();
  });

  it('collects blockers of included rows only and finds the cell to focus', () => {
    const unread = buildEntries('D', {
      5: { date: '2026-11-05', code: null, reviewReasons: [], confirmed: false },
    });
    const rows = [
      buildRow('r1', '김하루', { entries: unread }),
      buildRow('r2', '이소망', { entries: unread, excluded: true }),
      buildRow('r3', '박새벽'),
    ];
    const blockers = collectRosterBlockers(rows, DEFINITIONS);

    expect(blockers.map((row) => row.rowId)).toEqual(['r1']);

    const [first] = blockers[0]!.blockers;

    expect(first).toEqual({ reason: PublishBlockReason.UNCONFIRMED_DATES, dates: ['2026-11-05'] });
    expect(findBlockerDate(first!, unread)).toBe('2026-11-05');
    expect(isLegendBlocker(first!)).toBe(false);
    expect(
      findBlockerDate({ reason: PublishBlockReason.MISSING_TIMES, codes: ['D'] }, buildEntries('D')),
    ).toBe('2026-11-01');
  });

  it('offers only new, included people for "이름 바뀜"', () => {
    const rows = [
      buildRow('r1', '김하루', { isNewPerson: true }),
      buildRow('r2', '이소망', { isNewPerson: true, excluded: true }),
      buildRow('r3', '박새벽'),
    ];

    expect(listRenameCandidates(rows).map((row) => row.id)).toEqual(['r1']);
  });
});
