import { describe, expect, it } from 'vitest';

import { buildRowContext, isStripReadingVerified, matchesTargetName } from '@/server/vision/RowIdentity';
import { buildStripPersonPrompt } from '@/server/vision/VisionRowPrompts';

const CANDIDATES = [
  { rowId: 'r1', name: '가상하나' },
  { rowId: 'r2', name: '가상두울' },
  { rowId: 'r3', name: '가상 하나' },
];

const INPUT = { rowId: 'r3', name: '가상 하나', yearMonth: '2026-10', definitions: [] };

describe('buildRowContext', () => {
  it('finds neighbours and the same-name ordinal after name normalization', () => {
    expect(buildRowContext(CANDIDATES, 'r3')).toEqual({
      sameNameOrdinal: 2,
      sameNameCount: 2,
      above: '가상두울',
      below: null,
    });
    expect(buildRowContext(CANDIDATES, 'r2')).toMatchObject({ sameNameOrdinal: 1, sameNameCount: 1 });
    expect(buildRowContext(CANDIDATES, 'r9')).toBeNull();
  });
});

describe('row identity checks', () => {
  it('compares names after NFC and whitespace normalization and never accepts null', () => {
    expect(matchesTargetName('가상하나', '가상 하나')).toBe(true);
    expect(matchesTargetName('가상하나'.normalize('NFD'), '가상하나')).toBe(true);
    expect(matchesTargetName('가상두울', '가상하나')).toBe(false);
    expect(matchesTargetName(null, '가상하나')).toBe(false);
  });

  it('verifies a strip reading only with the target in the strip, the name and the duplicate ordinal', () => {
    const input = { ...INPUT, rowContext: buildRowContext(CANDIDATES, 'r3') };
    const reading = { rowName: '가상하나', targetInStrip: true, sameNameOrdinal: 2 };

    expect(isStripReadingVerified(reading, input)).toBe(true);
    expect(isStripReadingVerified({ ...reading, sameNameOrdinal: 1 }, input)).toBe(false);
    expect(isStripReadingVerified({ ...reading, sameNameOrdinal: null }, input)).toBe(false);
    expect(isStripReadingVerified({ ...reading, targetInStrip: false }, input)).toBe(false);
    expect(isStripReadingVerified({ ...reading, targetInStrip: null }, input)).toBe(false);
    expect(isStripReadingVerified({ ...reading, rowName: null }, input)).toBe(false);
    expect(isStripReadingVerified(undefined, input)).toBe(false);
    // Unique name: the ordinal is not required.
    expect(isStripReadingVerified({ ...reading, sameNameOrdinal: null }, INPUT)).toBe(true);
  });

  it('tells the strip prompt about neighbours and the duplicate occurrence as quoted data', () => {
    const prompt = buildStripPersonPrompt({ ...INPUT, rowContext: buildRowContext(CANDIDATES, 'r3') });

    expect(prompt).toContain('{"above":"가상두울","below":null}');
    expect(prompt).toContain('2 rows share this name; the target is occurrence 2 from the top');
    expect(buildStripPersonPrompt(INPUT)).not.toContain('share this name');
  });
});
