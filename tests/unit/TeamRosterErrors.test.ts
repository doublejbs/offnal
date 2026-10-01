import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import {
  classifyPublishFailure,
  formatUnlinkedWarning,
  isStaleBaseConflict,
  readRowBlockers,
  readUnlinkedRows,
} from '@/client/TeamRosterErrors';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { RosterPublishFailureKind } from '@/domain/enums/RosterPublishFailureKind';

const unlinked = [
  { rowKey: '김하루#2', displayName: '김하루', sameNameOrdinal: 2, sameNameCount: 2, linked: true },
  { rowKey: '이소망#1', displayName: '이소망', sameNameOrdinal: 1, sameNameCount: 1, linked: true },
];
const blockers = [
  {
    rowId: 'r1',
    rowKey: '김하루#1',
    displayName: '김하루',
    blockers: [{ reason: PublishBlockReason.UNCONFIRMED_DATES, dates: ['2026-11-05'] }],
  },
];
const blocked = (details: Record<string, unknown>) =>
  new ApiClientError(422, ApiErrorCode.PUBLISH_BLOCKED, '배포할 수 없어요', details);
const conflict = (reason: RevisionConflictReason) =>
  new ApiClientError(409, ApiErrorCode.REVISION_CONFLICT, '충돌', { reason, currentVersion: 3 });

describe('TeamRosterErrors', () => {
  it('reads 422 details: unlinked rows and row blockers (empty lists count as none)', () => {
    expect(readUnlinkedRows(blocked({ blockers: [], unlinkedRows: unlinked }))).toEqual(unlinked);
    expect(readUnlinkedRows(blocked({ blockers }))).toBeNull();
    expect(readRowBlockers(blocked({ blockers }))).toEqual(blockers);
    expect(readRowBlockers(blocked({ blockers: [], unlinkedRows: unlinked }))).toBeNull();
    expect(readRowBlockers(new ApiClientError(404, ApiErrorCode.NOT_FOUND, '없음', { blockers }))).toBeNull();
    expect(readUnlinkedRows(new Error('x'))).toBeNull();
  });

  it('tells STALE_BASE apart from a stale version', () => {
    expect(isStaleBaseConflict(conflict(RevisionConflictReason.STALE_BASE))).toBe(true);
    expect(isStaleBaseConflict(conflict(RevisionConflictReason.STALE_REVISION))).toBe(false);
    expect(isStaleBaseConflict(blocked({ reason: RevisionConflictReason.STALE_BASE }))).toBe(false);
  });

  it('classifies every publish failure the screen handles', () => {
    expect(classifyPublishFailure(blocked({ blockers: [], unlinkedRows: unlinked }))).toEqual({
      kind: RosterPublishFailureKind.UNLINKED_ROWS,
      unlinkedRows: unlinked,
    });
    expect(classifyPublishFailure(blocked({ blockers }))).toEqual({
      kind: RosterPublishFailureKind.BLOCKED,
      blockers,
    });
    expect(classifyPublishFailure(conflict(RevisionConflictReason.STALE_BASE)).kind).toBe(
      RosterPublishFailureKind.STALE_BASE,
    );
    expect(classifyPublishFailure(conflict(RevisionConflictReason.STALE_REVISION)).kind).toBe(
      RosterPublishFailureKind.STALE_VERSION,
    );
    expect(classifyPublishFailure(blocked({ blockers: [] })).kind).toBe(RosterPublishFailureKind.OTHER);
    expect(classifyPublishFailure(new ApiClientError(0, null, '네트워크')).kind).toBe(
      RosterPublishFailureKind.OTHER,
    );
  });

  it('names same-name people with their ordinal in the confirm text', () => {
    expect(formatUnlinkedWarning(unlinked)).toMatch(/^김하루 \(2\), 이소망님은/);
  });
});
