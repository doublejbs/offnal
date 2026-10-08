import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as monthRoute } from '@/app/api/calendar/[yearMonth]/route';
import { GET as calendarRoute } from '@/app/api/calendar/route';
import { POST as updateShareRoute } from '@/app/api/calendar/share/route';
import { GET as sharedRoute } from '@/app/api/shared/[token]/route';
import { MS_PER_DAY } from '@/domain/DomainLimits';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { AnalyticsSubjectKind } from '@/domain/enums/AnalyticsSubjectKind';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { flushAnalyticsForTesting } from '@/server/analytics/Analytics';
import { buildActorKey, buildSubjectKey } from '@/server/analytics/AnalyticsKeys';
import { getAppConfig } from '@/server/config/AppConfig';
import {
  analyticsEvents,
  type AnalyticsEventRow,
  calendars,
  drafts,
  recognitionJobs,
  users,
} from '@/server/db/Schema';
import { type LoggedInContext } from '@/server/http/RequestContext';
import { runCleanup } from '@/server/services/CleanupService';
import { requireLoggedInOwnedJob } from '@/server/services/RecognitionOwnership';
import { MOCK_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';

import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { claimJob, createReadyDraft, devLogin, publishDraft, uploadAndProcess } from '../helpers/OffnalFlows';
import { publishReady } from '../helpers/PaymentFlows';
import { createTeam, loggedInClient } from '../helpers/TeamFlows';
import { createRoster, extractNext, joinAndApprove, setupInvitedTeam } from '../helpers/TeamRosterFlows';

const FIRST_MONTH = '2026-10';
const SECOND_MONTH = '2026-11';
const DISPLAY_NAME = '지표 확인 사용자';

let env: IntegrationEnvironment;
const sandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

beforeEach(() => {
  sandbox.set({ ANALYTICS_SINK: 'db' });
});

afterEach(async () => {
  await flushAnalyticsForTesting();
  sandbox.restore();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await env.close();
});

const clearEvents = async (): Promise<void> => {
  await flushAnalyticsForTesting();
  await env.db.delete(analyticsEvents);
};

const readEvents = async (): Promise<AnalyticsEventRow[]> => {
  await flushAnalyticsForTesting();

  return env.db.select().from(analyticsEvents).orderBy(asc(analyticsEvents.createdAt));
};

const findUserId = async (displayName: string): Promise<string> => {
  const [user] = await env.db.select().from(users).where(eq(users.displayName, displayName));

  return user!.id;
};

const secret = (): string => getAppConfig().appSecret;

const jobKey = (jobId: string): string =>
  buildSubjectKey({ kind: AnalyticsSubjectKind.JOB, id: jobId }, secret());

describe('analytics events (sink=db)', () => {
  it('records the personal flow in order with linked pseudonymous keys', async () => {
    await clearEvents();

    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    expect((await devLogin(client, DISPLAY_NAME, `/recognitions/${jobId}`)).status).toBe(303);
    // Already claimed by the login: a repeated claim is not a second job_claimed.
    expect((await claimJob(client, jobId)).status).toBe(200);

    const ready = await createReadyDraft(client, jobId, FIRST_MONTH);

    expect((await publishReady(client, ready)).status).toBe(200);
    // Idempotent re-publish: no second month_published.
    expect((await publishDraft(client, ready.draft.id, ready.draft.revision)).status).toBe(200);

    const rows = await readEvents();
    const userId = await findUserId(DISPLAY_NAME);
    const actorKey = buildActorKey(userId, secret());

    expect(rows.map((row) => row.event)).toEqual([
      AnalyticsEvent.UPLOAD_STARTED,
      AnalyticsEvent.RECOGNITION_COMPLETED,
      AnalyticsEvent.LOGIN_COMPLETED,
      AnalyticsEvent.JOB_CLAIMED,
      AnalyticsEvent.DRAFT_CREATED,
      AnalyticsEvent.REVIEW_COMPLETED,
      AnalyticsEvent.MONTH_PUBLISHED,
    ]);

    const [upload, recognition, login, claim, draft, review, published] = rows;

    expect(upload).toMatchObject({ actorKey: null, subjectKey: jobKey(jobId), properties: { team: false } });
    expect(recognition).toMatchObject({ actorKey: null, subjectKey: jobKey(jobId) });
    expect(recognition!.properties).toMatchObject({ success: true, attempt: 1, team: false });
    expect(typeof recognition!.properties.ms).toBe('number');
    expect(login).toMatchObject({ actorKey, subjectKey: null, properties: { firstLogin: true } });
    expect(claim).toMatchObject({ actorKey, subjectKey: jobKey(jobId), properties: { atUpload: false } });
    expect(draft).toMatchObject({ actorKey, subjectKey: jobKey(jobId) });
    expect(draft!.properties).toMatchObject({ dayCount: 31, manual: false });
    expect(draft!.properties.reviewCells).toBeGreaterThan(0);
    expect(draft!.properties.unresolvedCells).toBeGreaterThan(0);
    expect(draft!.properties.reviewCells).toBeGreaterThanOrEqual(Number(draft!.properties.unresolvedCells));
    expect(typeof draft!.properties.ms).toBe('number');
    expect(review).toMatchObject({ actorKey, subjectKey: jobKey(jobId) });
    // createReadyDraft fills every unresolved day: those days differ from the AI draft.
    expect(review!.properties).toMatchObject({
      editedCells: draft!.properties.unresolvedCells,
      initialReviewCells: draft!.properties.reviewCells,
      fullMonthMatch: false,
    });
    expect(published).toMatchObject({
      actorKey,
      subjectKey: jobKey(jobId),
      properties: { revision: 1, monthIndex: 1, usedTrial: true, beta: false },
    });
  });

  it('marks a second distinct month as next_month_registered and an unedited draft as a full match', async () => {
    const client = createApiTestClient();
    const name = '두 달 사용자';
    const jobId = await uploadAndProcess(client);

    await devLogin(client, name, `/recognitions/${jobId}`);

    // Both drafts before the first publish (publishing deletes the photo).
    const first = await createReadyDraft(client, jobId, FIRST_MONTH);
    const second = await createReadyDraft(client, jobId, SECOND_MONTH);

    expect((await publishReady(client, first)).status).toBe(200);
    // A draft published exactly as the AI read it is a full match: make the stored AI draft equal the final one.
    await env.db
      .update(drafts)
      .set({ initialEntries: second.draft.entries })
      .where(eq(drafts.id, second.draft.id));
    await clearEvents();

    expect((await publishReady(client, second)).status).toBe(200);

    const rows = await readEvents();
    const actorKey = buildActorKey(await findUserId(name), secret());

    expect(rows.map((row) => row.event)).toEqual([
      AnalyticsEvent.REVIEW_COMPLETED,
      AnalyticsEvent.MONTH_PUBLISHED,
      AnalyticsEvent.NEXT_MONTH_REGISTERED,
    ]);
    expect(rows[0]!.properties).toMatchObject({ editedCells: 0, fullMonthMatch: true });
    expect(rows[1]!.properties).toMatchObject({ monthIndex: 2, usedTrial: true });
    expect(rows[2]).toMatchObject({ actorKey, properties: { monthIndex: 2 } });
  });

  it('records calendar and shared calendar views without the share token', async () => {
    const client = createApiTestClient();
    const name = '공유 지표 사용자';
    const jobId = await uploadAndProcess(client);

    await devLogin(client, name, `/recognitions/${jobId}`);
    expect((await publishReady(client, await createReadyDraft(client, jobId, FIRST_MONTH))).status).toBe(200);

    const share = await client.send(updateShareRoute, '/api/calendar/share', {
      json: { displayName: name, visibleMonths: [FIRST_MONTH] },
    });
    const token = new URL((await readJson<ShareSettingsResponse>(share)).url ?? '').pathname.slice(3);

    await clearEvents();

    // Summary and plain month reads (checkout, export sheet) are not calendar views; the month page sends view=1.
    expect((await client.send(calendarRoute, '/api/calendar')).status).toBe(200);
    expect(
      (await client.send(monthRoute, `/api/calendar/${FIRST_MONTH}`, { params: { yearMonth: FIRST_MONTH } }))
        .status,
    ).toBe(200);
    expect(
      (
        await client.send(monthRoute, `/api/calendar/${FIRST_MONTH}?view=1`, {
          params: { yearMonth: FIRST_MONTH },
        })
      ).status,
    ).toBe(200);

    const viewer = createApiTestClient();

    expect(
      (await viewer.send(sharedRoute, `/api/shared/${token}`, { params: { token }, origin: null })).status,
    ).toBe(200);

    const rows = await readEvents();
    const userId = await findUserId(name);
    const [calendar] = await env.db.select().from(calendars).where(eq(calendars.ownerId, userId));

    expect(rows.map((row) => row.event)).toEqual([
      AnalyticsEvent.CALENDAR_VIEWED,
      AnalyticsEvent.SHARED_CALENDAR_VIEWED,
    ]);
    expect(rows[0]).toMatchObject({ actorKey: buildActorKey(userId, secret()), subjectKey: null });
    expect(rows[1]).toMatchObject({
      actorKey: null,
      subjectKey: buildSubjectKey({ kind: AnalyticsSubjectKind.CALENDAR, id: calendar!.id }, secret()),
    });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('counts a logged-in upload as claimed at upload time', async () => {
    const client = createApiTestClient();
    const name = '로그인 후 업로드 사용자';

    await devLogin(client, name);
    await clearEvents();

    const jobId = await uploadAndProcess(client);
    const rows = await readEvents();
    const actorKey = buildActorKey(await findUserId(name), secret());

    expect(rows.map((row) => row.event)).toEqual([
      AnalyticsEvent.UPLOAD_STARTED,
      AnalyticsEvent.JOB_CLAIMED,
      AnalyticsEvent.RECOGNITION_COMPLETED,
    ]);
    expect(rows[1]).toMatchObject({ actorKey, subjectKey: jobKey(jobId), properties: { atUpload: true } });
  });

  it('logs job_claimed once when concurrent requests reach an unclaimed job', async () => {
    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);
    const [job] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, jobId));
    const [user] = await env.db.insert(users).values({ displayName: '동시 접근 사용자' }).returning();
    const context: LoggedInContext = {
      user: user!,
      sessionToken: null,
      supabaseUserId: null,
      anonymousSessionId: job!.anonymousSessionId,
      ip: '203.0.113.250',
      ipHash: 'hash',
    };

    await clearEvents();
    await Promise.all([
      requireLoggedInOwnedJob(env.db, context, jobId),
      requireLoggedInOwnedJob(env.db, context, jobId),
    ]);

    const rows = await readEvents();

    expect(rows.filter((row) => row.event === AnalyticsEvent.JOB_CLAIMED)).toHaveLength(1);
  });

  it('marks team roster uploads as team jobs', async () => {
    const team = await setupInvitedTeam('팀 업로드 관리자', '업로드 병동');

    await clearEvents();

    const rosterId = await createRoster(team.admin, team.teamId);

    await extractNext(team.admin, team.teamId, rosterId);

    const rows = await readEvents();
    const upload = rows.find((row) => row.event === AnalyticsEvent.UPLOAD_STARTED);
    const recognition = rows.find((row) => row.event === AnalyticsEvent.RECOGNITION_COMPLETED);

    expect(upload?.properties).toMatchObject({ team: true });
    expect(recognition?.properties).toMatchObject({ team: true });
    expect(rows.some((row) => row.event === AnalyticsEvent.JOB_CLAIMED)).toBe(false);
  });

  it('records team creation and an approved member', async () => {
    await clearEvents();

    const team = await setupInvitedTeam('팀 지표 관리자', '지표 병동');
    const { userId } = await joinAndApprove(env.db, team, '팀 지표 멤버', null);
    const rows = await readEvents();
    const teamKey = buildSubjectKey({ kind: AnalyticsSubjectKind.TEAM, id: team.teamId }, secret());

    expect(rows.find((row) => row.event === AnalyticsEvent.TEAM_CREATED)).toMatchObject({
      actorKey: buildActorKey(await findUserId('팀 지표 관리자'), secret()),
      subjectKey: teamKey,
      properties: { memberCount: 1 },
    });
    expect(rows.find((row) => row.event === AnalyticsEvent.TEAM_MEMBER_JOINED)).toMatchObject({
      actorKey: buildActorKey(userId, secret()),
      subjectKey: teamKey,
      properties: { memberCount: 2 },
    });
    expect(JSON.stringify(rows)).not.toContain('지표 병동');
  });

  it('stores no names, codes, ids or tokens: keys are hex and properties are numbers or booleans', async () => {
    const team = await loggedInClient('팀 없는 생성자');

    await createTeam(team, '이름 검사 팀');

    const rows = await readEvents();
    const serialized = JSON.stringify(rows);
    const userIds = (await env.db.select({ id: users.id }).from(users)).map((row) => row.id);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.actorKey === null || /^[0-9a-f]{32}$/.test(row.actorKey)).toBe(true);
      expect(row.subjectKey === null || /^[0-9a-f]{32}$/.test(row.subjectKey)).toBe(true);

      for (const value of Object.values(row.properties)) {
        expect(['number', 'boolean']).toContain(typeof value);
      }
    }

    for (const name of [...MOCK_CANDIDATE_NAMES, DISPLAY_NAME, '이름 검사 팀']) {
      expect(serialized).not.toContain(name);
    }

    for (const id of userIds) {
      expect(serialized).not.toContain(id);
    }
  });

  it('does not change responses when the analytics write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await env.db.execute(
      sql`alter table analytics_events add constraint analytics_events_test_reject check (false) not valid`,
    );

    try {
      const client = createApiTestClient();
      const jobId = await uploadAndProcess(client);

      expect((await devLogin(client, '기록 실패 사용자', `/recognitions/${jobId}`)).status).toBe(303);

      const ready = await createReadyDraft(client, jobId, FIRST_MONTH);

      expect((await publishReady(client, ready)).status).toBe(200);
      expect((await client.send(calendarRoute, '/api/calendar')).status).toBe(200);
      await flushAnalyticsForTesting();
    } finally {
      await env.db.execute(sql`alter table analytics_events drop constraint analytics_events_test_reject`);
    }

    const failures = warn.mock.calls.filter((call) => String(call[0]).includes('[analytics]'));

    expect(failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(failures)).not.toContain('기록 실패 사용자');
  });

  it('cleanup deletes events older than 400 days only', async () => {
    await clearEvents();

    const now = new Date();

    await env.db.insert(analyticsEvents).values([
      {
        event: AnalyticsEvent.UPLOAD_STARTED,
        properties: {},
        createdAt: new Date(now.getTime() - 401 * MS_PER_DAY),
      },
      {
        event: AnalyticsEvent.UPLOAD_STARTED,
        properties: {},
        createdAt: new Date(now.getTime() - 399 * MS_PER_DAY),
      },
    ]);

    const result = await runCleanup(env.db, env.storage, now);
    const remaining = await env.db.select().from(analyticsEvents);

    expect(result.analyticsEventsDeleted).toBe(1);
    expect(remaining).toHaveLength(1);
  });

  it('rejects unknown event names in the database', async () => {
    await expect(
      env.db.execute(sql`insert into analytics_events (event, properties) values ('free_text', '{}'::jsonb)`),
    ).rejects.toThrow();
  });
});
