import { describe, expect, it } from 'vitest';

import { describeStatusMonth, pickStatusMonth } from '@/client/TeamRosterStatus';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';

const roster = (yearMonth: string | null, status: TeamRosterStatus) => ({ yearMonth, status });

describe('pickStatusMonth', () => {
  it('prefers this month, then the nearest upcoming month, then the latest past one', () => {
    expect(pickStatusMonth([roster('2026-10', TeamRosterStatus.PUBLISHED)], '2026-10')).toBe('2026-10');
    expect(
      pickStatusMonth(
        [roster('2026-12', TeamRosterStatus.DRAFT), roster('2026-11', TeamRosterStatus.PUBLISHED)],
        '2026-10',
      ),
    ).toBe('2026-11');
    expect(pickStatusMonth([roster('2026-08', TeamRosterStatus.PUBLISHED)], '2026-10')).toBe('2026-08');
    expect(pickStatusMonth([], '2026-10')).toBe('2026-10');
  });

  it('ignores archived revisions and drafts whose month is not known yet', () => {
    expect(
      pickStatusMonth(
        [roster('2026-11', TeamRosterStatus.ARCHIVED), roster(null, TeamRosterStatus.DRAFT)],
        '2026-10',
      ),
    ).toBe('2026-10');
  });

  it('labels the card by where the month is', () => {
    expect(describeStatusMonth('2026-10', '2026-10')).toBe('이번 달 근무표');
    expect(describeStatusMonth('2026-11', '2026-10')).toBe('다가오는 근무표');
    expect(describeStatusMonth('2026-08', '2026-10')).toBe('최근 근무표');
  });
});
