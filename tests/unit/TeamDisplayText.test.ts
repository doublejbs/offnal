import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import {
  describeInvite,
  describeMembershipBadge,
  describeTeamError,
  describeRowReview,
  formatChangesHeadline,
  formatJoinableRow,
  formatMemberChanges,
  formatPersonChanges,
  formatRosterProgress,
  formatRowKey,
  formatRowName,
  formatSameNameLabel,
  isExtractionRunning,
  readMembershipConflictReason,
} from '@/client/TeamDisplayText';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';

import { buildProgress, buildRow } from './support/RosterUiFixture';

describe('TeamDisplayText', () => {
  it('shows "승인 대기" for pending requests and the role otherwise', () => {
    expect(describeMembershipBadge(TeamRole.MEMBER, TeamMemberStatus.PENDING)).toBe('승인 대기');
    expect(describeMembershipBadge(TeamRole.ADMIN, TeamMemberStatus.ACTIVE)).toBe('관리자');
    expect(describeMembershipBadge(TeamRole.MEMBER, TeamMemberStatus.ACTIVE)).toBe('팀원');
  });

  it('labels same-name rows with their ordinal and first codes', () => {
    expect(formatSameNameLabel('김하루', 1, 1)).toBe('김하루');
    expect(formatSameNameLabel('김하루', 2, 2)).toBe('김하루 (2)');
    expect(
      formatJoinableRow({
        rowKey: '김하루#2',
        displayName: '김하루',
        sameNameOrdinal: 2,
        sameNameCount: 2,
        firstCodes: ['D', null, 'OFF'],
      }),
    ).toBe('김하루 (2) — 1~3일 D · 빈칸 · OFF');
    expect(formatRowKey('김하루#2')).toBe('김하루 (2)');
    expect(formatRowKey('김하루#1')).toBe('김하루');
    expect(formatRowName({ displayName: '김하루', sameNameOrdinal: 1, sameNameCount: 2 })).toBe('김하루 (1)');
    expect(formatRowName({ displayName: '이소망', sameNameOrdinal: 1, sameNameCount: 1 })).toBe('이소망');
  });

  it('reports real extraction progress only', () => {
    expect(
      formatRosterProgress(buildProgress({ phase: TeamRosterPhase.RECOGNIZING, total: 0, done: 0 })),
    ).toBe('사진에서 근무표와 이름을 찾는 중이에요');
    expect(
      formatRosterProgress(
        buildProgress({ phase: TeamRosterPhase.EXTRACTING, total: 18, done: 10, manual: 2 }),
      ),
    ).toBe('12/18명 읽는 중');
    expect(formatRosterProgress(buildProgress({ total: 18, done: 16, failed: 2 }))).toBe(
      '18명 중 16명을 읽었어요 · 2명은 읽지 못했어요',
    );
    expect(formatRosterProgress(buildProgress({ total: 18, done: 18 }))).toBe('18명 모두 읽었어요');
    expect(isExtractionRunning(buildProgress({ phase: TeamRosterPhase.EXTRACTING }))).toBe(true);
    expect(isExtractionRunning(buildProgress({ phase: TeamRosterPhase.RECOGNITION_FAILED }))).toBe(false);
  });

  it('describes the per-person review status', () => {
    expect(describeRowReview(buildRow('r1', '김하루'), 3)).toBe('확인 필요 3칸');
    expect(describeRowReview(buildRow('r1', '김하루'), 0)).toBe('확인 완료');
    expect(describeRowReview(buildRow('r1', '김하루', { excluded: true }), 3)).toBe('제외됨');
    expect(
      describeRowReview(buildRow('r1', '김하루', { extractStatus: RosterRowExtractStatus.FAILED }), 30),
    ).toMatch(/^읽지 못했어요/);
  });

  it('summarizes changed cells per person', () => {
    const changes = [
      { date: '2026-11-03', fromCode: 'D', toCode: 'E' },
      { date: '2026-11-09', fromCode: null, toCode: 'N' },
    ];

    expect(
      formatChangesHeadline({
        comparedRevision: 2,
        totalChangedCells: 3,
        rows: [
          { rowKey: 'a#1', displayName: '김하루', changes },
          { rowKey: 'b#1', displayName: '이소망', changes: [changes[0]!] },
        ],
      }),
    ).toBe('바뀐 칸 3개 · 2명');
    expect(formatChangesHeadline({ comparedRevision: 2, totalChangedCells: 0, rows: [] })).toBe(
      '2번째 배포본과 같아요',
    );
    expect(formatPersonChanges('김하루', changes)).toBe('김하루 2칸: 3일 D→E, 9일 빈칸→N');
    expect(formatMemberChanges(changes)).toBe('근무가 바뀐 날 2일: 3일, 9일');
  });

  it('describes invite links', () => {
    const invite = {
      id: 'i1',
      createdAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-15T09:30:00.000Z',
      revokedAt: null,
      maxUses: null,
      useCount: 3,
      active: true,
    };

    expect(describeInvite(invite)).toBe('2026.10.15 18:30까지 · 3명 참여');
    expect(describeInvite({ ...invite, maxUses: 10 })).toBe('2026.10.15 18:30까지 · 3/10명 참여');
    expect(describeInvite({ ...invite, active: false, revokedAt: '2026-10-02T00:00:00.000Z' })).toBe(
      '중지됨 · 3명 참여',
    );
    expect(describeInvite({ ...invite, active: false })).toBe('만료됨 · 3명 참여');
  });

  it('reads membership conflict reasons from API errors', () => {
    const conflict = new ApiClientError(409, ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT, '...', {
      reason: TeamMembershipConflictReason.ROW_TAKEN,
    });

    expect(readMembershipConflictReason(conflict)).toBe(TeamMembershipConflictReason.ROW_TAKEN);
    expect(describeTeamError(conflict)).toBe('이미 다른 팀원과 연결된 이름이에요. 다른 이름을 골라 주세요.');
    expect(describeTeamError(new ApiClientError(404, ApiErrorCode.NOT_FOUND, '없어요'))).toBe('없어요');
    expect(readMembershipConflictReason(new ApiClientError(404, ApiErrorCode.NOT_FOUND, '...'))).toBeNull();
    expect(
      readMembershipConflictReason(
        new ApiClientError(409, ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT, '...', { reason: 'unknown' }),
      ),
    ).toBeNull();
  });
});
