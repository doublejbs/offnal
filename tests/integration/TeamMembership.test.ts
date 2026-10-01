import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as joinRoute } from '@/app/api/invites/[token]/join/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CreateTeamInviteResponse } from '@/domain/types/api/CreateTeamInviteResponse';
import { type InviteLookupResponse } from '@/domain/types/api/InviteLookupResponse';
import { type TeamInviteListResponse } from '@/domain/types/api/TeamInviteListResponse';
import { type TeamListResponse } from '@/domain/types/api/TeamListResponse';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';
import { type TeamMemberListResponse } from '@/domain/types/api/TeamMemberListResponse';
import { type TeamMembershipConflictDetails } from '@/domain/types/api/TeamMembershipConflictDetails';
import { hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { teamInvites, teamMembers } from '@/server/db/Schema';
import {
  type ApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { findUserId } from '../helpers/PaymentFlows';
import {
  approveMember,
  createInvite,
  findRowKey,
  getMyMonths,
  getTeam,
  issueInvite,
  joinAndApprove,
  leaveTeam,
  listInvites,
  listMembers,
  listTeams,
  loggedInClient,
  lookupInvite,
  type PublishedTeam,
  readInviteRows,
  rejectMember,
  removeMember,
  requestJoin,
  revokeInvite,
  setupPublishedTeam,
  TEAM_MONTH,
  updateMember,
} from '../helpers/TeamFlows';

let env: IntegrationEnvironment;
let team: PublishedTeam;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  team = await setupPublishedTeam('참여 관리자', '참여 병동');
});

afterAll(async () => {
  await env.close();
});

const readConflict = async (response: Response): Promise<TeamMembershipConflictReason> => {
  const body = await readJson<ApiErrorBody>(response);

  expect(response.status).toBe(409);
  expect(body.error.code).toBe(ApiErrorCode.TEAM_MEMBERSHIP_CONFLICT);

  return (body.error.details as TeamMembershipConflictDetails).reason;
};

const readMembers = async (client: ApiTestClient, teamId: string): Promise<TeamMemberListResponse> => {
  const response = await listMembers(client, teamId);

  expect(response.status).toBe(200);

  return readJson<TeamMemberListResponse>(response);
};

const findMember = async (teamId: string, userId: string): Promise<TeamMemberDto | undefined> =>
  (await readMembers(team.admin, teamId)).members.find((item) => item.userId === userId);

describe('invite links', () => {
  it('issues a 256-bit token shown once and stores only its hash', async () => {
    const issued = await issueInvite(team.admin, team.teamId);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.url).toBe(`${TEST_APP_URL}/join/${issued.token}`);
    expect(issued.invite).toMatchObject({ active: true, useCount: 0, maxUses: null, revokedAt: null });

    const expiresInDays =
      (Date.parse(issued.invite.expiresAt) - Date.parse(issued.invite.createdAt)) / 86_400_000;

    expect(Math.round(expiresInDays)).toBe(14);

    const [stored] = await env.db.select().from(teamInvites).where(eq(teamInvites.id, issued.invite.id));

    expect(stored?.tokenHash).toBe(hashSha256Hex(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);

    const listText = await (await listInvites(team.admin, team.teamId)).text();
    const list = JSON.parse(listText) as TeamInviteListResponse;

    expect(list.invites.some((invite) => invite.id === issued.invite.id)).toBe(true);
    expect(listText).not.toContain(issued.token);
  });

  it('validates invite options', async () => {
    expect((await createInvite(team.admin, team.teamId, { expiresInDays: 0 })).status).toBe(400);
    expect((await createInvite(team.admin, team.teamId, { expiresInDays: 31 })).status).toBe(400);
    expect((await createInvite(team.admin, team.teamId, { maxUses: 0 })).status).toBe(400);
  });

  it('stops working when revoked, expired or used up', async () => {
    const visitor = await loggedInClient('초대 확인 방문자');
    const revoked = await issueInvite(team.admin, team.teamId);

    expect((await lookupInvite(visitor, revoked.token)).status).toBe(200);
    expect((await revokeInvite(team.admin, team.teamId, revoked.invite.id)).status).toBe(200);
    expect((await lookupInvite(visitor, revoked.token)).status).toBe(404);
    expect((await requestJoin(visitor, revoked.token, null)).status).toBe(404);

    const expired = await issueInvite(team.admin, team.teamId);

    await env.db
      .update(teamInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(teamInvites.id, expired.invite.id));
    expect((await lookupInvite(visitor, expired.token)).status).toBe(404);

    const single = await readJson<CreateTeamInviteResponse>(
      await createInvite(team.admin, team.teamId, { maxUses: 1, expiresInDays: 3 }),
    );

    expect((await requestJoin(visitor, single.token, findRowKey(team.roster, '정겨울'))).status).toBe(200);

    const second = await loggedInClient('초대 두 번째 방문자');

    expect((await lookupInvite(second, single.token)).status).toBe(404);
    expect((await requestJoin(second, single.token, null)).status).toBe(404);
  });

  it('shows the logged-in viewer their membership', async () => {
    const viewer = await loggedInClient('초대 멤버십 방문자');

    expect(await readJson<InviteLookupResponse>(await lookupInvite(viewer, team.token))).toEqual({
      teamName: '참여 병동',
      membership: null,
    });
    expect((await requestJoin(viewer, team.token, null)).status).toBe(200);

    const after = await readJson<InviteLookupResponse>(await lookupInvite(viewer, team.token));

    expect(after.membership).toMatchObject({ teamId: team.teamId, status: TeamMemberStatus.PENDING });
  });
});

describe('join picker and requests', () => {
  it('lists rows of the latest published roster with ordinals and first 3 codes for same names', async () => {
    const visitor = await loggedInClient('동명이인 확인자');
    const rows = await readInviteRows(visitor, team.token);
    const kimRows = rows.rows.filter((row) => row.displayName === '김하루');

    expect(rows.yearMonth).toBe(TEAM_MONTH);
    expect(kimRows.map((row) => [row.sameNameOrdinal, row.sameNameCount, row.firstCodes])).toEqual([
      [1, 2, ['D', 'D', '연차']],
      [2, 2, ['OFF', 'D', '연차']],
    ]);
    expect(rows.rows.find((row) => row.displayName === '이여름')).toMatchObject({
      sameNameOrdinal: 1,
      sameNameCount: 1,
    });
  });

  it('handles a same-name request, approval and the picker without the linked row', async () => {
    const secondKim = findRowKey(team.roster, '김하루', 2);
    const { userId } = await joinAndApprove(env.db, team, '두 번째 김하루', secondKim);
    const member = await findMember(team.teamId, userId);

    expect(member).toMatchObject({
      status: TeamMemberStatus.ACTIVE,
      role: TeamRole.MEMBER,
      linkedRowKey: secondKim,
      linkedRow: { displayName: '김하루', sameNameOrdinal: 2, firstCodes: ['OFF', 'D', '연차'] },
    });

    const visitor = await loggedInClient('동명이인 두 번째 방문자');
    const rows = await readInviteRows(visitor, team.token);

    expect(rows.rows.map((row) => row.rowKey)).not.toContain(secondKim);
    expect(rows.rows.map((row) => row.rowKey)).toContain(findRowKey(team.roster, '김하루', 1));
    expect(await readConflict(await requestJoin(visitor, team.token, secondKim))).toBe(
      TeamMembershipConflictReason.ROW_TAKEN,
    );
  });

  it('rejects unknown rows, duplicate requests, repeated joins and forged origins', async () => {
    const visitor = await loggedInClient('중복 요청자');
    const rowKey = findRowKey(team.roster, '한바다');

    expect((await requestJoin(visitor, team.token, '없는사람#1')).status).toBe(400);
    expect(
      (
        await visitor.send(joinRoute, `/api/invites/${team.token}/join`, {
          json: { rowKey },
          params: { token: team.token },
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect((await requestJoin(visitor, team.token, rowKey)).status).toBe(200);
    expect(await readConflict(await requestJoin(visitor, team.token, rowKey))).toBe(
      TeamMembershipConflictReason.ALREADY_REQUESTED,
    );

    const userId = await findUserId(env.db, '중복 요청자');

    expect((await approveMember(team.admin, team.teamId, userId)).status).toBe(200);
    expect(await readConflict(await requestJoin(visitor, team.token, rowKey))).toBe(
      TeamMembershipConflictReason.ALREADY_MEMBER,
    );
    expect(await readConflict(await requestJoin(team.admin, team.token, null))).toBe(
      TeamMembershipConflictReason.ALREADY_MEMBER,
    );
  });

  it('lets the admin approve with a corrected row, and refuses a row already taken', async () => {
    const visitor = await loggedInClient('잘못 고른 사람');
    const userId = await findUserId(env.db, '잘못 고른 사람');

    expect((await requestJoin(visitor, team.token, findRowKey(team.roster, '오하늘'))).status).toBe(200);

    const pendingList = await readMembers(team.admin, team.teamId);

    expect(pendingList.members[0]?.status).toBe(TeamMemberStatus.PENDING);
    expect(pendingList.availableRows.map((row) => row.rowKey)).toContain(findRowKey(team.roster, '윤소리'));
    // 한바다 is linked by an active member.
    expect(
      await readConflict(
        await approveMember(team.admin, team.teamId, userId, { rowKey: findRowKey(team.roster, '한바다') }),
      ),
    ).toBe(TeamMembershipConflictReason.ROW_TAKEN);
    expect((await approveMember(team.admin, team.teamId, userId, { rowKey: '없는사람#1' })).status).toBe(400);

    const approved = await approveMember(team.admin, team.teamId, userId, {
      rowKey: findRowKey(team.roster, '윤소리'),
    });

    expect(approved.status).toBe(200);
    expect((await readJson<TeamMemberDto>(approved)).linkedRowKey).toBe(findRowKey(team.roster, '윤소리'));
    expect(await readConflict(await approveMember(team.admin, team.teamId, userId))).toBe(
      TeamMembershipConflictReason.INVALID_STATE,
    );
  });

  it('rejects a request: no access, not listed, may ask again', async () => {
    const visitor = await loggedInClient('거절될 사람');
    const userId = await findUserId(env.db, '거절될 사람');

    expect((await requestJoin(visitor, team.token, null)).status).toBe(200);
    expect((await rejectMember(team.admin, team.teamId, userId)).status).toBe(200);
    expect(await findMember(team.teamId, userId)).toBeUndefined();
    expect((await readJson<TeamListResponse>(await listTeams(visitor))).teams).toEqual([]);
    expect((await getMyMonths(visitor, team.teamId)).status).toBe(404);
    expect((await requestJoin(visitor, team.token, null)).status).toBe(200);
  });
});

describe('leaving, removal and admins', () => {
  it('lists PENDING and ACTIVE memberships of the viewer', async () => {
    const response = await listTeams(team.admin);
    const body = await readJson<TeamListResponse>(response);

    expect(response.status).toBe(200);
    expect(body.teams).toEqual([
      {
        teamId: team.teamId,
        teamName: '참여 병동',
        role: TeamRole.ADMIN,
        status: TeamMemberStatus.ACTIVE,
        linkedRowKey: null,
      },
    ]);
  });

  it('lets a member leave and an admin remove members; access ends immediately', async () => {
    const leaver = await joinAndApprove(
      env.db,
      team,
      '나가는 팀원',
      findRowKey(team.roster, '남궁하늘빛나래'),
    );

    expect((await getTeam(leaver.member, team.teamId)).status).toBe(200);
    expect((await leaveTeam(leaver.member, team.teamId)).status).toBe(200);
    expect((await getTeam(leaver.member, team.teamId)).status).toBe(404);
    expect((await readJson<TeamListResponse>(await listTeams(leaver.member))).teams).toEqual([]);

    // The freed row can be linked again.
    const next = await joinAndApprove(
      env.db,
      team,
      '이어받는 팀원',
      findRowKey(team.roster, '남궁하늘빛나래'),
    );

    expect((await removeMember(team.admin, team.teamId, next.userId)).status).toBe(200);
    expect((await getMyMonths(next.member, team.teamId)).status).toBe(404);

    const [row] = await env.db.select().from(teamMembers).where(eq(teamMembers.userId, next.userId));

    expect(row?.status).toBe(TeamMemberStatus.REMOVED);
  });

  it('protects the last admin and allows leaving after another admin is added', async () => {
    const adminId = await findUserId(env.db, '참여 관리자');

    expect(await readConflict(await leaveTeam(team.admin, team.teamId))).toBe(
      TeamMembershipConflictReason.LAST_ADMIN,
    );
    expect(await readConflict(await removeMember(team.admin, team.teamId, adminId))).toBe(
      TeamMembershipConflictReason.LAST_ADMIN,
    );
    expect(
      await readConflict(await updateMember(team.admin, team.teamId, adminId, { role: TeamRole.MEMBER })),
    ).toBe(TeamMembershipConflictReason.LAST_ADMIN);

    const deputy = await joinAndApprove(env.db, team, '부관리자', findRowKey(team.roster, '김하루', 1));
    const promoted = await updateMember(team.admin, team.teamId, deputy.userId, { role: TeamRole.ADMIN });

    expect(promoted.status).toBe(200);
    expect((await readJson<TeamMemberDto>(promoted)).role).toBe(TeamRole.ADMIN);
    expect((await listMembers(deputy.member, team.teamId)).status).toBe(200);

    // Changing a linked row and unlinking.
    const relinked = await updateMember(team.admin, team.teamId, deputy.userId, { rowKey: null });

    expect((await readJson<TeamMemberDto>(relinked)).linkedRowKey).toBeNull();

    expect((await leaveTeam(team.admin, team.teamId)).status).toBe(200);
    expect((await getTeam(team.admin, team.teamId)).status).toBe(404);
    expect(await readConflict(await leaveTeam(deputy.member, team.teamId))).toBe(
      TeamMembershipConflictReason.LAST_ADMIN,
    );
  });
});
