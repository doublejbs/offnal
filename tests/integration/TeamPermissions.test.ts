import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type InviteLookupResponse } from '@/domain/types/api/InviteLookupResponse';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { type TeamRosterViewResponse } from '@/domain/types/api/TeamRosterViewResponse';
import { MOCK_TEAM_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { findUserId } from '../helpers/PaymentFlows';
import {
  approveMember,
  createInvite,
  createTeam,
  extractNext,
  findRowKey,
  getInviteRows,
  getMyMonths,
  getRoster,
  getRosterView,
  getTeam,
  joinAndApprove,
  listInvites,
  listMembers,
  listRosters,
  loggedInClient,
  lookupInvite,
  patchRoster,
  publishRoster,
  type PublishedTeam,
  removeMember,
  requestJoin,
  setupPublishedTeam,
  TEAM_MONTH,
  updateTeam,
  uploadRoster,
} from '../helpers/TeamFlows';

let env: IntegrationEnvironment;
let team: PublishedTeam;
let member: ApiTestClient;
let pending: ApiTestClient;
let removed: ApiTestClient;
let outsider: ApiTestClient;
let otherAdmin: ApiTestClient;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  team = await setupPublishedTeam('권한 관리자', '권한 병동');
  ({ member } = await joinAndApprove(env.db, team, '권한 팀원', findRowKey(team.roster, '이여름')));

  pending = await loggedInClient('권한 대기자');
  expect((await requestJoin(pending, team.token, findRowKey(team.roster, '박지우'))).status).toBe(200);

  const removedMember = await joinAndApprove(
    env.db,
    team,
    '권한 내보낸 사람',
    findRowKey(team.roster, '최가을'),
  );

  removed = removedMember.member;
  expect((await removeMember(team.admin, team.teamId, removedMember.userId)).status).toBe(200);

  outsider = await loggedInClient('권한 외부인');
  otherAdmin = await loggedInClient('다른 팀 관리자');
  await createTeam(otherAdmin, '다른 병동');
});

afterAll(async () => {
  await env.close();
});

const expectNotFound = async (response: Response): Promise<void> => {
  expect(response.status).toBe(404);
  expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.NOT_FOUND);
};

type Probe = (client: ApiTestClient) => Promise<Response>;

const ADMIN_PROBES: [string, Probe][] = [
  ['GET members', (client) => listMembers(client, team.teamId)],
  ['GET invites', (client) => listInvites(client, team.teamId)],
  ['POST invites', (client) => createInvite(client, team.teamId)],
  ['GET rosters', (client) => listRosters(client, team.teamId)],
  ['GET roster (admin)', (client) => getRoster(client, team.teamId, team.rosterId)],
  ['PATCH roster', (client) => patchRoster(client, team.teamId, team.rosterId, { version: 1 })],
  ['POST extract-next', (client) => extractNext(client, team.teamId, team.rosterId)],
  ['POST publish', (client) => publishRoster(client, team.teamId, team.rosterId, 1)],
  ['POST rosters (upload)', (client) => uploadRoster(client, team.teamId)],
  ['PATCH team', (client) => updateTeam(client, team.teamId, { name: '바꾼 이름' })],
];

const MEMBER_PROBES: [string, Probe][] = [
  ['GET team', (client) => getTeam(client, team.teamId)],
  ['GET my-months', (client) => getMyMonths(client, team.teamId)],
  ['GET roster view', (client) => getRosterView(client, team.teamId, TEAM_MONTH)],
];

describe('team permission matrix', () => {
  const outsiders = (): [string, ApiTestClient][] => [
    ['non-member', outsider],
    ['PENDING requester', pending],
    ['REMOVED member', removed],
    ['other team admin', otherAdmin],
  ];

  it.each([...ADMIN_PROBES, ...MEMBER_PROBES])(
    '%s → 404 for everyone outside the team',
    async (_name, probe) => {
      for (const [, client] of outsiders()) {
        await expectNotFound(await probe(client));
      }
    },
  );

  it.each(ADMIN_PROBES)('%s → 404 for an ACTIVE member (admin only)', async (_name, probe) => {
    await expectNotFound(await probe(member));
  });

  it('requires login for team endpoints', async () => {
    const anonymous = createApiTestClient();

    expect((await getTeam(anonymous, team.teamId)).status).toBe(401);
    expect((await getInviteRows(anonymous, team.token)).status).toBe(401);
    expect((await requestJoin(anonymous, team.token, null)).status).toBe(401);
  });

  it('rejects mutations without the app origin', async () => {
    const forged = await uploadRoster(team.admin, team.teamId, { origin: 'https://evil.example' });

    expect(forged.status).toBe(403);
    expect((await readJson<ApiErrorBody>(forged)).error.code).toBe(ApiErrorCode.FORBIDDEN_ORIGIN);
  });

  it('cannot approve members of another team even as an admin', async () => {
    const pendingId = await findUserId(env.db, '권한 대기자');

    await expectNotFound(await approveMember(otherAdmin, team.teamId, pendingId));
    await expectNotFound(await approveMember(member, team.teamId, pendingId));
  });
});

describe('pre-login invite page', () => {
  it('returns only the team name, no people or schedules', async () => {
    const anonymous = createApiTestClient();
    const response = await lookupInvite(anonymous, team.token);
    const text = await response.clone().text();
    const body = await readJson<InviteLookupResponse>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(body).toEqual({ teamName: '권한 병동' });

    for (const name of MOCK_TEAM_CANDIDATE_NAMES) {
      expect(text).not.toContain(name);
    }
  });

  it('answers 404 for unknown or malformed tokens', async () => {
    const anonymous = createApiTestClient();

    await expectNotFound(await lookupInvite(anonymous, 'not-a-token'));
    await expectNotFound(await lookupInvite(anonymous, 'A'.repeat(43)));
  });
});

describe('full roster visibility', () => {
  it('shows ACTIVE members names, dates and codes only — never review data or source cells', async () => {
    const response = await getRosterView(member, team.teamId, TEAM_MONTH);
    const text = await response.clone().text();
    const view = await readJson<TeamRosterViewResponse>(response);

    expect(response.status).toBe(200);
    expect(view.rows).toHaveLength(MOCK_TEAM_CANDIDATE_NAMES.length);
    expect(view.rows.filter((row) => row.isMine).map((row) => row.displayName)).toEqual(['이여름']);
    expect(Object.keys(view.rows[0]?.entries[0] ?? {}).sort()).toEqual(['code', 'date']);
    expect(text).not.toContain('reviewReasons');
    expect(text).not.toContain('sourceCells');
    expect(text).not.toContain('rawText');
    expect(text).not.toContain('confirmed');
  });

  it('hides the full roster from members while the setting is off, immediately', async () => {
    const off = await updateTeam(team.admin, team.teamId, { shareRosterWithMembers: false });

    expect(off.status).toBe(200);
    expect((await readJson<TeamDetailResponse>(off)).team.shareRosterWithMembers).toBe(false);
    await expectNotFound(await getRosterView(member, team.teamId, TEAM_MONTH));
    // Admins always see it; the member still sees their own row.
    expect((await getRosterView(team.admin, team.teamId, TEAM_MONTH)).status).toBe(200);
    expect((await getMyMonths(member, team.teamId)).status).toBe(200);

    expect((await updateTeam(team.admin, team.teamId, { shareRosterWithMembers: true })).status).toBe(200);
    expect((await getRosterView(member, team.teamId, TEAM_MONTH)).status).toBe(200);
  });

  it('defaults to sharing the roster with members', async () => {
    const admin = await loggedInClient('기본값 관리자');
    const created = await createTeam(admin, '기본값 병동');

    expect(created.team.shareRosterWithMembers).toBe(true);
  });

  it('answers 404 for a month without a published roster', async () => {
    await expectNotFound(await getRosterView(member, team.teamId, '2027-05'));
  });
});
