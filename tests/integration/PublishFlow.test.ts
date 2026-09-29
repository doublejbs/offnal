import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as editMonthRoute } from '@/app/api/calendar/[yearMonth]/edit/route';
import { DELETE as deleteMonthRoute, GET as getMonthRoute } from '@/app/api/calendar/[yearMonth]/route';
import { GET as calendarRoute } from '@/app/api/calendar/route';
import { DELETE as deleteDraftRoute } from '@/app/api/drafts/[id]/route';
import { POST as extractRoute } from '@/app/api/recognitions/[id]/extract/route';
import { GET as sourceRoute } from '@/app/api/recognitions/[id]/source/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type EditPublishedMonthResponse } from '@/domain/types/api/EditPublishedMonthResponse';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { entitlements, publishedMonths, recognitionJobs, users } from '@/server/db/Schema';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import {
  createLoggedInJob,
  createReadyDraft,
  extractRow,
  patchDraft,
  publishDraft,
  readDraft,
  resolveEntries,
  uploadAndProcess,
} from '../helpers/OffnalFlows';

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterAll(async () => {
  await env.close();
});

const getUserId = async (displayName: string): Promise<string> => {
  const [user] = await env.db.select().from(users).where(eq(users.displayName, displayName));

  if (!user) {
    throw new Error(`user not found: ${displayName}`);
  }

  return user.id;
};

const countTrials = async (userId: string): Promise<number> => {
  const rows = await env.db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.source, EntitlementSource.TRIAL)));

  return rows.length;
};

const getMonth = (client: ApiTestClient, yearMonth: string) =>
  client.send(getMonthRoute, `/api/calendar/${yearMonth}`, { params: { yearMonth } });

const publishReady = async (client: ApiTestClient, draft: DraftResponse): Promise<Response> =>
  publishDraft(client, draft.draft.id, draft.draft.revision);

describe('publish blockers', () => {
  it('rejects unresolved dates and codes without times with 422', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '차단 사용자');
    const draftId = await extractRow(client, jobId, '2026-11');
    const draft = await readDraft(client, draftId);
    const blockedResponse = await publishDraft(client, draftId, draft.draft.revision);
    const blockedBody = await readJson<ApiErrorBody>(blockedResponse);
    const blockers = blockedBody.error.details?.blockers as PublishBlocker[];

    expect(blockedResponse.status).toBe(422);
    expect(blockedBody.error.code).toBe(ApiErrorCode.PUBLISH_BLOCKED);
    expect(blockers.map((blocker) => blocker.reason)).toContain(PublishBlockReason.UNCONFIRMED_DATES);

    const withCustomCode = await patchDraft(client, draftId, {
      revision: draft.draft.revision,
      definitions: [
        ...draft.draft.definitions,
        { code: 'X', label: '교육', startTime: null, endTime: null, endsNextDay: null, isOff: false },
      ],
      entries: resolveEntries(draft.draft.entries, 'X'),
    });
    const patched = await readJson<DraftResponse>(withCustomCode);

    expect(withCustomCode.status).toBe(200);

    const missingTimes = await publishDraft(client, draftId, patched.draft.revision);
    const missingBody = await readJson<ApiErrorBody>(missingTimes);

    expect(missingTimes.status).toBe(422);
    expect(missingBody.error.details?.blockers).toEqual([
      { reason: PublishBlockReason.MISSING_TIMES, codes: ['X'] },
    ]);
    expect(await countTrials(await getUserId('차단 사용자'))).toBe(0);
  });

  it('rejects invalid entry sets, codes and definitions with 400', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '검증 초안 사용자');
    const draftId = await extractRow(client, jobId, '2026-11');
    const draft = await readDraft(client, draftId);
    const { revision, entries, definitions } = draft.draft;
    const invalidBodies = [
      { revision, entries: entries.slice(1) },
      {
        revision,
        entries: entries.map((entry, index) => (index === 0 ? { ...entry, code: 'lower' } : entry)),
      },
      { revision, definitions: [...definitions, { ...definitions[0], label: '가'.repeat(21) }] },
      { revision, definitions: [...definitions, definitions[0]] },
      { revision, definitions: [{ ...definitions[0], startTime: '25:00' }] },
      { revision, yearMonth: '2026-13' },
    ];

    for (const body of invalidBodies) {
      expect((await patchDraft(client, draftId, body)).status).toBe(400);
    }

    expect((await readDraft(client, draftId)).draft.revision).toBe(revision);
  });

  it('returns 409 with the current draft on a stale revision', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '충돌 사용자');
    const draftId = await extractRow(client, jobId, '2026-11');

    expect((await patchDraft(client, draftId, { revision: 1, displayName: '새 이름' })).status).toBe(200);

    const stale = await patchDraft(client, draftId, { revision: 1, displayName: '오래된 이름' });
    const body = await readJson<ApiErrorBody>(stale);
    const current = body.error.details?.draft as DraftResponse;

    expect(stale.status).toBe(409);
    expect(body.error.code).toBe(ApiErrorCode.REVISION_CONFLICT);
    expect(current.draft).toMatchObject({ revision: 2, displayName: '새 이름' });
  });

  it('remaps entries when the month changes', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '월 변경 사용자');
    const draftId = await extractRow(client, jobId, '2026-10');
    const response = await patchDraft(client, draftId, { revision: 1, yearMonth: '2027-02' });
    const remapped = await readJson<DraftResponse>(response);

    expect(response.status).toBe(200);
    expect(remapped.draft.yearMonth).toBe('2027-02');
    expect(remapped.draft.entries).toHaveLength(28);
    expect(remapped.draft.entries[0]?.date).toBe('2027-02-01');
  });
});

describe('entitlements', () => {
  it('re-publishing the same month does not consume another trial; the third unique month needs payment', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '요금 사용자');
    const userId = await getUserId('요금 사용자');
    const first = await createReadyDraft(client, jobId, '2026-10');
    // Publishing deletes the source photo, so extract every month up front.
    const second = await createReadyDraft(client, jobId, '2026-11');
    const third = await createReadyDraft(client, jobId, '2026-12');
    const firstPublish = await readJson<PublishDraftResponse>(await publishReady(client, first));

    expect(firstPublish).toMatchObject({ usedTrial: true, alreadyPublished: false, publishedRevision: 1 });

    const again = await publishReady(client, first);

    expect(again.status).toBe(200);
    expect(await readJson<PublishDraftResponse>(again)).toMatchObject({
      alreadyPublished: true,
      usedTrial: false,
    });

    expect(await extractRow(client, jobId, '2026-10')).toBe(first.draft.id);

    const editResponse = await client.send(editMonthRoute, '/api/calendar/2026-10/edit', {
      method: 'POST',
      params: { yearMonth: '2026-10' },
    });
    const { draftId: editDraftId } = await readJson<EditPublishedMonthResponse>(editResponse);
    const editDraft = await readDraft(client, editDraftId);

    expect(editDraft.access.monthAccess).toBe(MonthAccess.EXISTING);

    const republish = await readJson<PublishDraftResponse>(await publishReady(client, editDraft));

    expect(republish).toMatchObject({ usedTrial: false, publishedRevision: 2 });
    expect(await countTrials(userId)).toBe(1);

    expect((await publishReady(client, second)).status).toBe(200);
    expect(await countTrials(userId)).toBe(2);

    expect((await readDraft(client, third.draft.id)).access.monthAccess).toBe(MonthAccess.PAYMENT_REQUIRED);

    const thirdResponse = await publishReady(client, third);
    const thirdBody = await readJson<ApiErrorBody>(thirdResponse);

    expect(thirdResponse.status).toBe(402);
    expect(thirdBody.error.code).toBe(ApiErrorCode.PAYMENT_REQUIRED);
    expect(await countTrials(userId)).toBe(2);
    expect((await readDraft(client, third.draft.id)).draft.status).toBe(DraftStatus.EDITING);
  });

  it('grants at most two trials when three different months are published concurrently', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '동시 사용자');
    const userId = await getUserId('동시 사용자');
    const ready = [
      await createReadyDraft(client, jobId, '2027-01'),
      await createReadyDraft(client, jobId, '2027-02'),
      await createReadyDraft(client, jobId, '2027-03'),
    ];
    const responses = await Promise.all(ready.map((draft) => publishReady(client, draft)));
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([200, 200, 402]);
    expect(await countTrials(userId)).toBe(2);
  });

  it('keeps entitlements when a published month is deleted', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '삭제 사용자');
    const userId = await getUserId('삭제 사용자');
    const draft = await createReadyDraft(client, jobId, '2026-10');

    await publishReady(client, draft);

    const deleteResponse = await client.send(deleteMonthRoute, '/api/calendar/2026-10', {
      method: 'DELETE',
      params: { yearMonth: '2026-10' },
    });

    expect(deleteResponse.status).toBe(200);
    expect((await getMonth(client, '2026-10')).status).toBe(404);
    expect(await countTrials(userId)).toBe(1);

    const summary = await readJson<CalendarSummaryResponse>(
      await client.send(calendarRoute, '/api/calendar'),
    );

    expect(summary.months).toEqual([]);
    expect(summary.freeRemaining).toBe(1);

    const newJobId = await uploadAndProcess(client);
    const again = await createReadyDraft(client, newJobId, '2026-11');
    const editAfterDelete = await client.send(editMonthRoute, '/api/calendar/2026-10/edit', {
      method: 'POST',
      params: { yearMonth: '2026-10' },
    });

    expect(editAfterDelete.status).toBe(404);
    expect(again.access.monthAccess).toBe(MonthAccess.TRIAL_AVAILABLE);
  });
});

describe('published calendar isolation', () => {
  it('does not change the published month until the edit draft is published', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '달력 사용자');
    const draft = await createReadyDraft(client, jobId, '2026-10');

    await publishReady(client, draft);

    const before = await readJson<CalendarMonthResponse>(await getMonth(client, '2026-10'));

    expect(before).toMatchObject({ yearMonth: '2026-10', revision: 1, shareVisible: false });
    expect(before.displayName).toBe(draft.draft.displayName);

    const editResponse = await client.send(editMonthRoute, '/api/calendar/2026-10/edit', {
      method: 'POST',
      params: { yearMonth: '2026-10' },
    });
    const { draftId } = await readJson<EditPublishedMonthResponse>(editResponse);
    const secondEdit = await readJson<EditPublishedMonthResponse>(
      await client.send(editMonthRoute, '/api/calendar/2026-10/edit', {
        method: 'POST',
        params: { yearMonth: '2026-10' },
      }),
    );

    expect(editResponse.status).toBe(200);
    expect(secondEdit.draftId).toBe(draftId);

    const editDraft = await readDraft(client, draftId);

    expect(editDraft.jobId).toBeNull();
    expect(editDraft.sourceAvailable).toBe(false);

    const changedEntries = editDraft.draft.entries.map((entry) =>
      entry.date === '2026-10-01' ? { ...entry, code: 'S' } : entry,
    );
    const patched = await readJson<DraftResponse>(
      await patchDraft(client, draftId, { revision: editDraft.draft.revision, entries: changedEntries }),
    );
    const during = await readJson<CalendarMonthResponse>(await getMonth(client, '2026-10'));

    expect(during.entries).toEqual(before.entries);
    expect(during.revision).toBe(1);

    await publishDraft(client, draftId, patched.draft.revision);

    const after = await readJson<CalendarMonthResponse>(await getMonth(client, '2026-10'));

    expect(after.revision).toBe(2);
    expect(after.entries.find((entry) => entry.date === '2026-10-01')?.code).toBe('S');

    const summary = await readJson<CalendarSummaryResponse>(
      await client.send(calendarRoute, '/api/calendar'),
    );

    expect(summary.calendar).toEqual({ displayName: draft.draft.displayName });
    expect(summary.share).toEqual({ enabled: false, url: null, displayName: draft.draft.displayName });
    expect(summary.months).toHaveLength(1);
    expect(summary.months[0]?.workCount).toBeGreaterThan(0);
    expect((summary.months[0]?.workCount ?? 0) + (summary.months[0]?.offCount ?? 0)).toBe(31);
  });

  it('preserves share visibility when a month is re-published', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '공개 유지 사용자');
    const draft = await createReadyDraft(client, jobId, '2026-10');

    await publishReady(client, draft);
    await env.db.update(publishedMonths).set({ shareVisible: true });

    const { draftId } = await readJson<EditPublishedMonthResponse>(
      await client.send(editMonthRoute, '/api/calendar/2026-10/edit', {
        method: 'POST',
        params: { yearMonth: '2026-10' },
      }),
    );
    const editDraft = await readDraft(client, draftId);

    await publishReady(client, editDraft);

    expect((await readJson<CalendarMonthResponse>(await getMonth(client, '2026-10'))).shareVisible).toBe(
      true,
    );
  });

  it('deletes the source photo after publishing and discards drafts without touching entitlements', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '원본 삭제 사용자');
    const draft = await createReadyDraft(client, jobId, '2026-10');
    const [before] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, jobId));

    expect(before?.sourceObjectKey).toBeTruthy();
    expect(await env.storage.exists(before?.sourceObjectKey ?? '')).toBe(true);

    await publishReady(client, draft);

    const [after] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, jobId));

    expect(after?.sourceDeletedAt).not.toBeNull();
    expect(await env.storage.exists(before?.sourceObjectKey ?? '')).toBe(false);
    expect(
      (await client.send(sourceRoute, `/api/recognitions/${jobId}/source`, { params: { id: jobId } })).status,
    ).toBe(410);

    const extractAfterDelete = await client.send(extractRoute, `/api/recognitions/${jobId}/extract`, {
      json: { rowId: 'r1', yearMonth: '2026-11' },
      params: { id: jobId },
    });

    expect(extractAfterDelete.status).toBe(410);

    const { draftId } = await readJson<EditPublishedMonthResponse>(
      await client.send(editMonthRoute, '/api/calendar/2026-10/edit', {
        method: 'POST',
        params: { yearMonth: '2026-10' },
      }),
    );
    const discard = await client.send(deleteDraftRoute, `/api/drafts/${draftId}`, {
      method: 'DELETE',
      params: { id: draftId },
    });

    expect(discard.status).toBe(200);
    expect((await readJson<CalendarMonthResponse>(await getMonth(client, '2026-10'))).revision).toBe(1);
    expect(await countTrials(await getUserId('원본 삭제 사용자'))).toBe(1);
  });
});
