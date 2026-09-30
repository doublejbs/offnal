import { describe, expect, it } from 'vitest';

import { buildRowContext, isReadingVerified, matchesTargetName } from '@/server/vision/RowIdentity';
import { buildPersonUserPrompt } from '@/server/vision/VisionPrompts';
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

const verifyStrip = (
  reading: Parameters<typeof isReadingVerified>[0],
  input: Parameters<typeof isReadingVerified>[1],
) => isReadingVerified(reading, input, { requireInStrip: true });

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

    expect(verifyStrip(reading, input)).toBe(true);
    expect(verifyStrip({ ...reading, sameNameOrdinal: 1 }, input)).toBe(false);
    expect(verifyStrip({ ...reading, sameNameOrdinal: null }, input)).toBe(false);
    expect(verifyStrip({ ...reading, targetInStrip: false }, input)).toBe(false);
    expect(verifyStrip({ ...reading, targetInStrip: null }, input)).toBe(false);
    expect(verifyStrip({ ...reading, rowName: null }, input)).toBe(false);
    expect(verifyStrip(undefined, input)).toBe(false);
    // Unique name: the ordinal is not required.
    expect(verifyStrip({ ...reading, sameNameOrdinal: null }, INPUT)).toBe(true);
  });

  it('requires the reported occurrence for duplicate names on full-table reads too', () => {
    const input = { ...INPUT, rowContext: buildRowContext(CANDIDATES, 'r3') };
    const fullRead = (sameNameOrdinal: number | null) =>
      isReadingVerified({ rowName: '가상하나', targetInStrip: null, sameNameOrdinal }, input, {
        requireInStrip: false,
      });

    expect(fullRead(2)).toBe(true);
    expect(fullRead(1)).toBe(false);
    expect(fullRead(null)).toBe(false);
  });

  it('gives both prompts the neighbours and the duplicate count, never the expected occurrence', () => {
    const input = { ...INPUT, rowContext: buildRowContext(CANDIDATES, 'r3') };

    for (const prompt of [buildStripPersonPrompt(input), buildPersonUserPrompt(input)]) {
      expect(prompt).toContain('{"above":"가상두울","below":null}');
      expect(prompt).toContain('2 rows share this name');
      expect(prompt).toContain('which of the 2 same-name rows you read (1 = topmost)');
      expect(prompt).not.toMatch(/occurrence 2|ordinal 2/u);
    }

    expect(buildStripPersonPrompt(INPUT)).not.toContain('share this name');
  });
});
