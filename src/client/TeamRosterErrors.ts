import { isApiClientError } from '@/client/ApiClient';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RevisionConflictReason } from '@/domain/enums/RevisionConflictReason';
import { type PreviousRowRef } from '@/domain/types/api/PreviousRowRef';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';

/** Reading the structured details of roster publish / revert failures (TeamShareSpec §15.2). Pure. */

export const STALE_BASE_MESSAGE =
  '이 초안을 만든 뒤 더 새 버전이 배포됐어요. 팀 화면에서 최신 배포본의 “수정하기”로 다시 시작해 주세요.';

const readPublishBlockedDetails = (error: unknown): Record<string, unknown> | null =>
  isApiClientError(error) && error.code === ApiErrorCode.PUBLISH_BLOCKED ? (error.details ?? {}) : null;

/** 422 `details.unlinkedRows` (linked members would lose their month); null when not that case. */
export const readUnlinkedRows = (error: unknown): PreviousRowRef[] | null => {
  const rows = readPublishBlockedDetails(error)?.unlinkedRows;

  return Array.isArray(rows) && rows.length > 0 ? (rows as PreviousRowRef[]) : null;
};

/** 422 `details.blockers` (rows still needing review); null when not that case or empty. */
export const readRowBlockers = (error: unknown): TeamRosterRowBlocker[] | null => {
  const blockers = readPublishBlockedDetails(error)?.blockers;

  return Array.isArray(blockers) && blockers.length > 0 ? (blockers as TeamRosterRowBlocker[]) : null;
};

export const isStaleBaseConflict = (error: unknown): boolean =>
  isApiClientError(error) &&
  error.code === ApiErrorCode.REVISION_CONFLICT &&
  (error.details as TeamRosterConflictDetails | undefined)?.reason === RevisionConflictReason.STALE_BASE;

/** Confirm text listing who would lose this month: "김하루, 이소망님의 이 달 근무가 달력에서 사라져요." */
export const formatUnlinkedWarning = (rows: PreviousRowRef[]): string =>
  `${rows.map((row) => row.displayName).join(', ')}님은 팀원과 연결돼 있는데 이 버전에 없어요. 그대로 배포하면 이분들의 달력에서 이 달 근무가 사라져요.`;
