import { describe, expect, it } from 'vitest';

import {
  assignRowKeys,
  buildNextRowKey,
  buildRowKey,
  computeSameNameLabels,
  matchRowKeys,
} from '@/domain/TeamRowKey';

describe('TeamRowKey', () => {
  it('builds keys from the normalized name and the same-name ordinal', () => {
    expect(buildRowKey('김하루', 1)).toBe('김하루#1');
    expect(buildRowKey(' 김 하루 ', 2)).toBe('김하루#2');
    // NFD input normalizes to the same key as NFC.
    expect(buildRowKey('김하루'.normalize('NFD'), 1)).toBe('김하루#1');
  });

  it('numbers same names in table order', () => {
    expect(assignRowKeys(['김하루', '이여름', '김 하루', '김하루'])).toEqual([
      { rowKey: '김하루#1', sameNameOrdinal: 1 },
      { rowKey: '이여름#1', sameNameOrdinal: 1 },
      { rowKey: '김하루#2', sameNameOrdinal: 2 },
      { rowKey: '김하루#3', sameNameOrdinal: 3 },
    ]);
  });

  it('picks the first free ordinal for manual rows', () => {
    expect(buildNextRowKey('김하루', [])).toBe('김하루#1');
    expect(buildNextRowKey('김하루', ['김하루#1', '김하루#3'])).toBe('김하루#2');
    expect(buildNextRowKey('이여름', ['김하루#1'])).toBe('이여름#1');
  });

  it('labels same-name rows with ordinal and count', () => {
    expect(computeSameNameLabels(['김하루', '이여름', '김하루'])).toEqual([
      { sameNameOrdinal: 1, sameNameCount: 2 },
      { sameNameOrdinal: 1, sameNameCount: 1 },
      { sameNameOrdinal: 2, sameNameCount: 2 },
    ]);
  });

  it('matches revisions by row key', () => {
    expect(matchRowKeys(['김하루#1', '김하루#2', '이여름#1'], ['김하루#1', '이여름#1', '박지우#1'])).toEqual({
      matched: ['김하루#1', '이여름#1'],
      added: ['박지우#1'],
      missing: ['김하루#2'],
    });
  });

  it('keeps people apart when one of two same-name rows leaves (ordinals shift)', () => {
    // Known limitation documented in the spec: the second 김하루 becomes #1 and matches the first one's key.
    const previous = assignRowKeys(['김하루', '김하루']).map((item) => item.rowKey);
    const next = assignRowKeys(['김하루']).map((item) => item.rowKey);

    expect(matchRowKeys(previous, next)).toEqual({ matched: ['김하루#1'], added: [], missing: ['김하루#2'] });
  });
});
