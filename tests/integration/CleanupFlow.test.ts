import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GET as cleanupRoute } from '@/app/api/cron/cleanup/route';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { MS_PER_DAY, MS_PER_HOUR } from '@/domain/DomainLimits';
import {
  anonymousSessions,
  drafts,
  paymentEvents,
  payments,
  publishedMonths,
  rateLimitCounters,
  recognitionJobs,
  sessions,
} from '@/server/db/Schema';
import { type CleanupResult } from '@/server/services/CleanupService';
import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { setObjectStorageForTesting } from '@/server/storage/StorageFactory';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createLoggedInJob, createReadyDraft, extractRow, uploadAndProcess } from '../helpers/OffnalFlows';
import { findUserId, publishReady } from '../helpers/PaymentFlows';

const CRON_SECRET = 'test-cron-secret';

let env: IntegrationEnvironment;
const envSandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  envSandbox.restore();
  setObjectStorageForTesting(env.storage);
});

afterAll(async () => {
  await env.close();
});

const runCleanup = (authorization: string | null = `Bearer ${CRON_SECRET}`) =>
  createApiTestClient().send(cleanupRoute, '/api/cron/cleanup', {
    origin: null,
    headers: authorization === null ? {} : { authorization },
  });

const findJob = async (jobId: string) => {
  const [job] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, jobId));

  return job;
};

const past = (ms: number): Date => new Date(Date.now() - ms);

describe('cleanup authorization', () => {
  it('rejects missing or wrong secrets and is unavailable without CRON_SECRET', async () => {
    expect((await runCleanup(null)).status).toBe(401);
    expect((await runCleanup('Bearer wrong')).status).toBe(401);
    expect((await runCleanup(CRON_SECRET)).status).toBe(401);

    envSandbox.set({ CRON_SECRET: undefined });

    expect((await runCleanup()).status).toBe(503);
  });
});

describe('cleanup run', () => {
  it('expires jobs, retries source deletion, removes stale rows and is idempotent', async () => {
    // Expired anonymous job: source + temporary table (other people's names) must go.
    const anonymous = createApiTestClient();
    const expiredJobId = await uploadAndProcess(anonymous);

    await env.db
      .update(recognitionJobs)
      .set({ expiresAt: past(MS_PER_HOUR) })
      .where(eq(recognitionJobs.id, expiredJobId));

    // Published job whose post-publish source deletion "failed".
    const owner = createApiTestClient();
    const publishedJobId = await createLoggedInJob(owner, '정리 사용자');
    const draft = await createReadyDraft(owner, publishedJobId, '2026-10');

    await publishReady(owner, draft);
    await env.storage.put(`sources/${publishedJobId}`, Buffer.from('left over'), 'image/png');
    await env.db
      .update(recognitionJobs)
      .set({ sourceDeletedAt: null })
      .where(eq(recognitionJobs.id, publishedJobId));

    // Live job with an unpublished draft: untouched.
    const liveJobId = await uploadAndProcess(owner);
    const liveDraftId = await extractRow(owner, liveJobId, '2026-11');

    // Expired drafts: an editing one and the published one (the snapshot lives in published_months).
    const expiredDraftId = await extractRow(owner, liveJobId, '2026-12');

    await env.db
      .update(drafts)
      .set({ expiresAt: past(MS_PER_HOUR) })
      .where(eq(drafts.id, expiredDraftId));
    await env.db
      .update(drafts)
      .set({ expiresAt: past(MS_PER_HOUR) })
      .where(eq(drafts.id, draft.draft.id));

    // Old counters, expired sessions, stale pending payment.
    const userId = await findUserId(env.db, '정리 사용자');

    await env.db.insert(rateLimitCounters).values([
      { key: 'old-counter', windowStart: past(50 * MS_PER_DAY), count: 3 },
      { key: 'recent-counter', windowStart: past(MS_PER_DAY), count: 3 },
    ]);
    await env.db.insert(sessions).values({ id: 'expired-session', userId, expiresAt: past(MS_PER_HOUR) });
    await env.db.insert(anonymousSessions).values({ id: 'expired-anon', expiresAt: past(MS_PER_HOUR) });

    const [stalePayment] = await env.db
      .insert(payments)
      .values({
        userId,
        yearMonth: '2027-01',
        amount: 1900,
        provider: PaymentProviderType.MOCK,
        status: PaymentStatus.PENDING,
        createdAt: past(30 * MS_PER_HOUR),
        updatedAt: past(25 * MS_PER_HOUR),
      })
      .returning();
    const [freshPayment] = await env.db
      .insert(payments)
      .values({
        userId,
        yearMonth: '2027-02',
        amount: 1900,
        provider: PaymentProviderType.MOCK,
        status: PaymentStatus.PENDING,
      })
      .returning();

    await env.db.insert(paymentEvents).values([
      { provider: PaymentProviderType.MOCK, eventKey: 'old-processed', processedAt: past(31 * MS_PER_DAY) },
      { provider: PaymentProviderType.MOCK, eventKey: 'recent-processed', processedAt: past(MS_PER_DAY) },
      { provider: PaymentProviderType.MOCK, eventKey: 'old-unprocessed', receivedAt: past(31 * MS_PER_DAY) },
    ]);

    const response = await runCleanup();
    const result = await readJson<CleanupResult>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(result).toMatchObject({
      expiredJobs: 1,
      sourceDeleteFailures: 0,
      draftsDeleted: 2,
      rateLimitCountersDeleted: 1,
      paymentsCanceled: 1,
      paymentEventsDeleted: 1,
    });
    expect(result.sourcesDeleted).toBe(2);
    expect(result.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.anonymousSessionsDeleted).toBeGreaterThanOrEqual(1);

    const expiredJob = await findJob(expiredJobId);

    expect(expiredJob).toMatchObject({ status: RecognitionStatus.EXPIRED, tableResult: null });
    expect(expiredJob?.sourceDeletedAt).not.toBeNull();
    expect(await env.storage.exists(`sources/${expiredJobId}`)).toBe(false);

    expect((await findJob(publishedJobId))?.sourceDeletedAt).not.toBeNull();
    expect(await env.storage.exists(`sources/${publishedJobId}`)).toBe(false);

    const liveJob = await findJob(liveJobId);

    expect(liveJob?.status).toBe(RecognitionStatus.RECOGNIZED);
    expect(liveJob?.tableResult).not.toBeNull();
    expect(await env.storage.exists(`sources/${liveJobId}`)).toBe(true);

    const remainingDrafts = await env.db.select({ id: drafts.id, status: drafts.status }).from(drafts);

    expect(remainingDrafts.map((row) => row.id)).toContain(liveDraftId);
    expect(remainingDrafts.map((row) => row.id)).not.toContain(expiredDraftId);
    expect(remainingDrafts.map((row) => row.id)).not.toContain(draft.draft.id);
    expect(remainingDrafts.find((row) => row.id === liveDraftId)?.status).toBe(DraftStatus.EDITING);
    expect(await env.db.select().from(publishedMonths)).toHaveLength(1);

    const counterKeys = (await env.db.select().from(rateLimitCounters)).map((row) => row.key);

    expect(counterKeys).toContain('recent-counter');
    expect(counterKeys).not.toContain('old-counter');
    expect(await env.db.select().from(sessions).where(eq(sessions.id, 'expired-session'))).toEqual([]);
    expect(
      await env.db.select().from(anonymousSessions).where(eq(anonymousSessions.id, 'expired-anon')),
    ).toEqual([]);

    const paymentStatuses = await env.db.select({ id: payments.id, status: payments.status }).from(payments);

    expect(paymentStatuses.find((row) => row.id === stalePayment?.id)?.status).toBe(PaymentStatus.CANCELED);
    expect(paymentStatuses.find((row) => row.id === freshPayment?.id)?.status).toBe(PaymentStatus.PENDING);

    const eventKeys = (await env.db.select().from(paymentEvents)).map((row) => row.eventKey);

    expect(eventKeys).toEqual(expect.arrayContaining(['recent-processed', 'old-unprocessed']));
    expect(eventKeys).not.toContain('old-processed');

    const second = await readJson<CleanupResult>(await runCleanup());

    expect(second).toEqual({
      expiredJobs: 0,
      sourcesDeleted: 0,
      sourceDeleteFailures: 0,
      draftsDeleted: 0,
      rateLimitCountersDeleted: 0,
      sessionsDeleted: 0,
      anonymousSessionsDeleted: 0,
      paymentsCanceled: 0,
      paymentEventsDeleted: 0,
      teamRosterDraftsDeleted: 0,
    });
  });

  it('marks expired jobs even when the source object is already gone', async () => {
    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    await env.storage.delete(`sources/${jobId}`);
    await env.db
      .update(recognitionJobs)
      .set({ expiresAt: past(MS_PER_HOUR) })
      .where(eq(recognitionJobs.id, jobId));

    const result = await readJson<CleanupResult>(await runCleanup());

    expect(result.expiredJobs).toBe(1);
    expect(result.sourceDeleteFailures).toBe(0);
    expect(await findJob(jobId)).toMatchObject({ status: RecognitionStatus.EXPIRED, tableResult: null });
  });

  it('keeps going past an object that keeps failing and retries it after the others', async () => {
    const client = createApiTestClient();
    const failingJobId = await uploadAndProcess(client);
    const otherJobId = await uploadAndProcess(client);

    await env.db
      .update(recognitionJobs)
      .set({ expiresAt: past(2 * MS_PER_HOUR) })
      .where(eq(recognitionJobs.id, failingJobId));
    await env.db
      .update(recognitionJobs)
      .set({ expiresAt: past(MS_PER_HOUR) })
      .where(eq(recognitionJobs.id, otherJobId));
    setObjectStorageForTesting({
      ...env.storage,
      delete: async (key) => {
        if (key === `sources/${failingJobId}`) {
          throw new Error('storage unavailable');
        }

        await env.storage.delete(key);
      },
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await readJson<CleanupResult>(await runCleanup());

    expect(result).toMatchObject({ expiredJobs: 2, sourcesDeleted: 1, sourceDeleteFailures: 1 });
    expect(await findJob(failingJobId)).toMatchObject({
      status: RecognitionStatus.EXPIRED,
      tableResult: null,
      sourceDeletedAt: null,
    });
    expect((await findJob(otherJobId))?.sourceDeletedAt).not.toBeNull();
    expect(await env.storage.exists(`sources/${otherJobId}`)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    setObjectStorageForTesting(env.storage);

    const retry = await readJson<CleanupResult>(await runCleanup());

    expect(retry).toMatchObject({ expiredJobs: 0, sourcesDeleted: 1, sourceDeleteFailures: 0 });
    expect(await env.storage.exists(`sources/${failingJobId}`)).toBe(false);
  });
});
