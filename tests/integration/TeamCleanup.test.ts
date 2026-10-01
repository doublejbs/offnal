import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MS_PER_DAY, MS_PER_HOUR } from '@/domain/DomainLimits';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import {
  recognitionJobs,
  teamInvites,
  teamMembers,
  teamRosterRows,
  teamRosters,
  teams,
  users,
} from '@/server/db/Schema';
import { runCleanup } from '@/server/services/CleanupService';
import { type IntegrationEnvironment, setupIntegrationEnvironment } from '../helpers/ApiTestClient';
import { findUserId } from '../helpers/PaymentFlows';
import {
  createRoster,
  deleteTeam,
  extractNext,
  findRowKey,
  getMyMonths,
  getTeam,
  joinAndApprove,
  lookupInvite,
  setupPublishedTeam,
} from '../helpers/TeamFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterAll(async () => {
  await env.close();
});

const findJob = async (jobId: string | null) => {
  const [job] = await env.db
    .select()
    .from(recognitionJobs)
    .where(eq(recognitionJobs.id, jobId ?? ''));

  return job;
};

const findRoster = async (rosterId: string) => {
  const [roster] = await env.db.select().from(teamRosters).where(eq(teamRosters.id, rosterId));

  return roster;
};

describe('team roster sources', () => {
  it('deletes the source photo after publishing and expires unpublished uploads with the source TTL', async () => {
    const team = await setupPublishedTeam('정리 관리자', '정리 병동');
    const published = await findRoster(team.rosterId);
    const publishedJob = await findJob(published?.sourceJobId ?? null);

    expect(publishedJob?.sourceDeletedAt).not.toBeNull();
    expect(await env.storage.exists(`sources/${publishedJob?.id}`)).toBe(false);

    const draftId = await createRoster(team.admin, team.teamId);

    await extractNext(team.admin, team.teamId, draftId);

    const draft = await findRoster(draftId);
    const draftJob = await findJob(draft?.sourceJobId ?? null);

    expect(await env.storage.exists(`sources/${draftJob?.id}`)).toBe(true);

    // 25 hours later the unpublished upload's photo and temporary table (everyone's names) are gone.
    const result = await runCleanup(env.db, env.storage, new Date(Date.now() + 25 * MS_PER_HOUR));
    const expiredJob = await findJob(draftJob?.id ?? null);

    expect(result.sourcesDeleted).toBeGreaterThanOrEqual(1);
    expect(expiredJob).toMatchObject({ status: RecognitionStatus.EXPIRED, tableResult: null });
    expect(await env.storage.exists(`sources/${draftJob?.id}`)).toBe(false);
    // The draft rows themselves stay editable until the draft TTL.
    expect(await findRoster(draftId)).toBeDefined();

    const later = await runCleanup(env.db, env.storage, new Date(Date.now() + 31 * MS_PER_DAY));

    expect(later.teamRosterDraftsDeleted).toBe(1);
    expect(await findRoster(draftId)).toBeUndefined();
    // Published revisions are kept.
    expect(await findRoster(team.rosterId)).toBeDefined();
  });
});

describe('deleting a team', () => {
  it('removes rosters, rows, invites and memberships but keeps the users', async () => {
    const team = await setupPublishedTeam('삭제 관리자', '삭제 병동');
    const { member, userId } = await joinAndApprove(
      env.db,
      team,
      '삭제 팀원',
      findRowKey(team.roster, '이여름'),
    );

    expect((await deleteTeam(member, team.teamId)).status).toBe(404);

    const draftId = await createRoster(team.admin, team.teamId);

    await extractNext(team.admin, team.teamId, draftId);

    const draftJobId = (await findRoster(draftId))?.sourceJobId ?? null;

    expect((await deleteTeam(team.admin, team.teamId)).status).toBe(200);
    expect((await getTeam(team.admin, team.teamId)).status).toBe(404);
    expect((await getMyMonths(member, team.teamId)).status).toBe(404);
    expect((await lookupInvite(member, team.token)).status).toBe(404);
    expect(await env.db.select().from(teams).where(eq(teams.id, team.teamId))).toEqual([]);
    expect(await env.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.teamId))).toEqual([]);
    expect(await env.db.select().from(teamInvites).where(eq(teamInvites.teamId, team.teamId))).toEqual([]);
    expect(await env.db.select().from(teamRosters).where(eq(teamRosters.teamId, team.teamId))).toEqual([]);
    expect(
      await env.db
        .select()
        .from(teamRosterRows)
        .where(inArray(teamRosterRows.rosterId, [team.rosterId, draftId])),
    ).toEqual([]);

    // The unpublished upload's names and photo are removed right away, not at the TTL.
    const draftJob = await findJob(draftJobId);

    expect(draftJob).toMatchObject({ status: RecognitionStatus.EXPIRED, tableResult: null });
    expect(await env.storage.exists(`sources/${draftJobId}`)).toBe(false);

    const adminId = await findUserId(env.db, '삭제 관리자');

    expect(
      await env.db
        .select()
        .from(users)
        .where(inArray(users.id, [adminId, userId])),
    ).toHaveLength(2);
  });
});
