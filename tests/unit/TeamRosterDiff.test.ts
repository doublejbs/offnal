import { describe, expect, it } from 'vitest';

import { collapseRevisionChanges, diffRosterRows, type DiffRow } from '@/domain/TeamRosterDiff';

const row = (rowKey: string, codes: (string | null)[], excluded = false): DiffRow => ({
  rowKey,
  excluded,
  entries: codes.map((code, index) => ({ date: `2026-11-0${index + 1}`, code })),
});

describe('diffRosterRows', () => {
  it('lists changed cells of people present in both revisions, in next-row order', () => {
    const previous = [row('이여름#1', ['D', 'E', 'N']), row('김하루#1', ['OFF', 'OFF', 'D'])];
    const next = [row('김하루#1', ['OFF', 'D', 'D']), row('이여름#1', ['D', 'E', null])];

    expect(diffRosterRows(previous, next)).toEqual([
      { rowKey: '김하루#1', date: '2026-11-02', fromCode: 'OFF', toCode: 'D' },
      { rowKey: '이여름#1', date: '2026-11-03', fromCode: 'N', toCode: null },
    ]);
  });

  it('ignores added, removed and excluded people', () => {
    const previous = [row('김하루#1', ['D']), row('퇴사자#1', ['N']), row('제외#1', ['D'], true)];
    const next = [
      row('김하루#1', ['D']),
      row('신규#1', ['E']),
      row('제외#1', ['N']),
      row('퇴사자#1', ['E'], true),
    ];

    expect(diffRosterRows(previous, next)).toEqual([]);
  });

  it('compares dates missing on one side as empty', () => {
    expect(diffRosterRows([row('김하루#1', ['D'])], [row('김하루#1', ['D', 'E'])])).toEqual([
      { rowKey: '김하루#1', date: '2026-11-02', fromCode: null, toCode: 'E' },
    ]);
  });
});

describe('collapseRevisionChanges', () => {
  it('keeps the first original and the last new code per date and drops dates changed back', () => {
    expect(
      collapseRevisionChanges([
        { revision: 3, date: '2026-11-02', fromCode: 'N', toCode: 'OFF' },
        { revision: 2, date: '2026-11-02', fromCode: 'D', toCode: 'N' },
        { revision: 2, date: '2026-11-01', fromCode: 'E', toCode: 'D' },
        { revision: 3, date: '2026-11-01', fromCode: 'D', toCode: 'E' },
      ]),
    ).toEqual([{ date: '2026-11-02', fromCode: 'D', toCode: 'OFF' }]);
  });
});
