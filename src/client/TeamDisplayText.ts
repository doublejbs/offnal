import { isApiClientError } from '@/client/ApiClient';
import { formatDateTime } from '@/client/DisplayText';
import { formatDayOnly } from '@/client/MonthLayout';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';
import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';
import { type TeamInviteDto } from '@/domain/types/api/TeamInviteDto';
import { type TeamRosterChangePreview } from '@/domain/types/api/TeamRosterChangePreview';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';

/** Korean copy for the team screens (docs/TeamShareSpec.md §8). Pure: unit-tested. */

const EMPTY_CODE = '빈칸';

const MEMBERSHIP_CONFLICT_TEXT: Record<TeamMembershipConflictReason, string> = {
  [TeamMembershipConflictReason.ALREADY_MEMBER]: '이미 이 팀의 팀원이에요.',
  [TeamMembershipConflictReason.ALREADY_REQUESTED]:
    '이미 참여를 요청했어요. 관리자가 승인하면 달력에 나타나요.',
  [TeamMembershipConflictReason.ROW_TAKEN]: '이미 다른 팀원과 연결된 이름이에요. 다른 이름을 골라 주세요.',
  [TeamMembershipConflictReason.LAST_ADMIN]:
    '팀에는 관리자가 한 명 이상 있어야 해요. 다른 관리자를 먼저 지정해 주세요.',
  [TeamMembershipConflictReason.INVALID_STATE]: '지금 상태에서는 할 수 없는 요청이에요. 새로고침해 주세요.',
};

export const describeTeamRole = (role: TeamRole): string => (role === TeamRole.ADMIN ? '관리자' : '팀원');

/** Badge text of a membership: PENDING requests show "승인 대기" instead of the role. */
export const describeMembershipBadge = (role: TeamRole, status: TeamMemberStatus): string =>
  status === TeamMemberStatus.PENDING ? '승인 대기' : describeTeamRole(role);

const isConflictReason = (value: unknown): value is TeamMembershipConflictReason =>
  Object.values(TeamMembershipConflictReason).includes(value as TeamMembershipConflictReason);

/** `details.reason` of a 409 TEAM_MEMBERSHIP_CONFLICT, else null. */
export const readMembershipConflictReason = (error: unknown): TeamMembershipConflictReason | null => {
  if (!isApiClientError(error) || error.code !== ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT) {
    return null;
  }

  const reason = error.details?.reason;

  return isConflictReason(reason) ? reason : null;
};

export const describeMembershipConflict = (reason: TeamMembershipConflictReason): string =>
  MEMBERSHIP_CONFLICT_TEXT[reason];

/** "김하루" or "김하루 (2)" when the roster has more than one person with that name. */
export const formatSameNameLabel = (
  displayName: string,
  sameNameOrdinal: number,
  sameNameCount: number,
): string => (sameNameCount > 1 ? `${displayName} (${sameNameOrdinal})` : displayName);

/** "D · E · 빈칸" — first codes that tell same-name rows apart. */
export const formatFirstCodes = (codes: (string | null)[]): string =>
  codes.map((code) => code ?? EMPTY_CODE).join(' · ');

/** Join / approval picker label: "김하루 (2) — 1~3일 D · E · 빈칸". */
export const formatJoinableRow = (row: JoinableRowDto): string => {
  const name = formatSameNameLabel(row.displayName, row.sameNameOrdinal, row.sameNameCount);

  return row.firstCodes.length > 0
    ? `${name} — 1~${row.firstCodes.length}일 ${formatFirstCodes(row.firstCodes)}`
    : name;
};

/** Readable name of a row key ("김하루#2" → "김하루 (2)", "김하루#1" → "김하루") when no row data is at hand. */
export const formatRowKey = (rowKey: string): string => {
  const separator = rowKey.lastIndexOf('#');
  const name = separator > 0 ? rowKey.slice(0, separator) : rowKey;
  const ordinal = Number(separator > 0 ? rowKey.slice(separator + 1) : '1');

  return Number.isInteger(ordinal) && ordinal > 1 ? `${name} (${ordinal})` : name;
};

/** Rows read so far: DONE + MANUAL (FAILED rows are reported separately). */
export const countReadRows = (progress: TeamRosterProgress): number => progress.done + progress.manual;

/** Real progress only (Handoff: no fake percentages): "사진 확인 중", "12/18명 읽는 중", "18명 모두 읽었어요". */
export const formatRosterProgress = (progress: TeamRosterProgress): string => {
  if (progress.phase === TeamRosterPhase.RECOGNIZING) {
    return '사진에서 근무표와 이름을 찾는 중이에요';
  }

  if (progress.phase === TeamRosterPhase.RECOGNITION_FAILED) {
    return '근무표를 읽지 못했어요';
  }

  const read = countReadRows(progress);

  if (progress.phase === TeamRosterPhase.EXTRACTING) {
    return `${read}/${progress.total}명 읽는 중`;
  }

  if (progress.failed > 0) {
    return `${progress.total}명 중 ${read}명을 읽었어요 · ${progress.failed}명은 읽지 못했어요`;
  }

  return `${progress.total}명 모두 읽었어요`;
};

export const isExtractionRunning = (progress: TeamRosterProgress): boolean =>
  progress.phase === TeamRosterPhase.RECOGNIZING || progress.phase === TeamRosterPhase.EXTRACTING;

/** Mobile person list status: "확인 필요 3칸", "읽지 못했어요", "제외됨", "확인 완료". */
export const describeRowReview = (row: TeamRosterRowDto, reviewCount: number): string => {
  if (row.excluded) {
    return '제외됨';
  }

  if (
    row.extractStatus === RosterRowExtractStatus.PENDING ||
    row.extractStatus === RosterRowExtractStatus.PROCESSING
  ) {
    return '읽는 중';
  }

  if (row.extractStatus === RosterRowExtractStatus.FAILED) {
    return '읽지 못했어요 · 직접 입력하거나 다시 시도';
  }

  return reviewCount > 0 ? `확인 필요 ${reviewCount}칸` : '확인 완료';
};

const formatCode = (code: string | null): string => code ?? EMPTY_CODE;

/** "14일 D→E" */
export const formatCellChange = (change: TeamCellChange): string =>
  `${formatDayOnly(change.date)} ${formatCode(change.fromCode)}→${formatCode(change.toCode)}`;

/** "바뀐 칸 5개 · 2명", or "N번째 배포본과 같아요" when nothing changed. */
export const formatChangesHeadline = (preview: TeamRosterChangePreview): string =>
  preview.totalChangedCells === 0
    ? `${preview.comparedRevision}번째 배포본과 같아요`
    : `바뀐 칸 ${preview.totalChangedCells}개 · ${preview.rows.length}명`;

/** One line per person: "김하루 3칸: 3일 D→E, 4일 E→OFF, 9일 빈칸→N". */
export const formatPersonChanges = (displayName: string, changes: TeamCellChange[]): string =>
  `${displayName} ${changes.length}칸: ${changes.map(formatCellChange).join(', ')}`;

/** Member calendar notice for team changes: "근무가 바뀐 날 3일: 3일, 4일, 9일". */
export const formatMemberChanges = (changes: TeamCellChange[]): string =>
  `근무가 바뀐 날 ${changes.length}일: ${changes.map((change) => formatDayOnly(change.date)).join(', ')}`;

/** "2026.10.15 18:30까지 · 3명 참여 · 최대 10명" */
export const describeInvite = (invite: TeamInviteDto): string => {
  const uses =
    invite.maxUses === null ? `${invite.useCount}명 참여` : `${invite.useCount}/${invite.maxUses}명 참여`;

  if (invite.revokedAt) {
    return `중지됨 · ${uses}`;
  }

  if (!invite.active) {
    return `만료됨 · ${uses}`;
  }

  return `${formatDateTime(invite.expiresAt)}까지 · ${uses}`;
};

/** "3번째 배포본" */
export const formatRevision = (revision: number): string => `${revision}번째 배포본`;
