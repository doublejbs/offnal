import { describe, expect, it } from 'vitest';

import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';

const definition = (code: string): ShiftDefinition => ({
  code,
  label: code,
  startTime: null,
  endTime: null,
  endsNextDay: null,
  isOff: true,
});

describe('filterUsedDefinitions', () => {
  it('keeps only codes that appear, in definition order', () => {
    const definitions = [definition('D'), definition('E'), definition('N'), definition('OFF')];
    const entries = [
      { date: '2026-10-01', code: 'N' },
      { date: '2026-10-02', code: null },
      { date: '2026-10-03', code: 'D' },
      { date: '2026-10-04', code: 'N' },
    ];

    expect(filterUsedDefinitions(definitions, entries).map((item) => item.code)).toEqual(['D', 'N']);
  });
});
