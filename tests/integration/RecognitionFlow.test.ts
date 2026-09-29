import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as calendarRoute } from '@/app/api/calendar/route';
import { GET as candidatesRoute } from '@/app/api/recognitions/[id]/candidates/route';
import { POST as extractRoute } from '@/app/api/recognitions/[id]/extract/route';
import { POST as processRoute } from '@/app/api/recognitions/[id]/process/route';
import { GET as sourceRoute } from '@/app/api/recognitions/[id]/source/route';
import { GET as statusRoute } from '@/app/api/recognitions/[id]/status/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { RateLimitScope } from '@/domain/enums/RateLimitScope';
import { RateLimitWindow } from '@/domain/enums/RateLimitWindow';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type CandidatesResponse } from '@/domain/types/api/CandidatesResponse';
import { type CreateRecognitionResponse } from '@/domain/types/api/CreateRecognitionResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type ExtractRecognitionResponse } from '@/domain/types/api/ExtractRecognitionResponse';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { type RecognitionStatusResponse } from '@/domain/types/api/RecognitionStatusResponse';
import { currentYearMonthInSeoul, nextYearMonth } from '@/domain/YearMonth';
import { drafts, entitlements, rateLimitCounters, recognitionJobs, users } from '@/server/db/Schema';
import { buildRateLimitKey } from '@/server/services/RateLimitService';
import { createRecognitionJob } from '@/server/services/RecognitionProcessService';
import { createMockVisionProvider, MOCK_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import { type VisionProvider } from '@/server/vision/VisionProvider';
import { setVisionProviderForTesting } from '@/server/vision/VisionFactory';
import {
  createApiTestClient,
  createNarrowPng,
  createPngFixture,
  createTablePng,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import {
  claimJob,
  devLogin,
  extractRow,
  MOCK_FIRST_ROW_ID,
  patchDraft,
  publishDraft,
  readDraft,
  resolveEntries,
  uploadAndProcess,
  uploadImage,
} from '../helpers/OffnalFlows';

const MOCK_CODES = ['"D"', '"E"', '"N"', '"S"', '"OFF"'];

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterAll(async () => {
  await env.close();
});

const getStatus = (client: ReturnType<typeof createApiTestClient>, id: string) =>
  client.send(statusRoute, `/api/recognitions/${id}/status`, { params: { id } });

const processJob = (client: ReturnType<typeof createApiTestClient>, id: string) =>
  client.send(processRoute, `/api/recognitions/${id}/process`, { method: 'POST', params: { id } });

describe('anonymous upload → login → extract → publish', () => {
  it('completes the whole flow without leaking recognition data before login', async () => {
    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    expect(client.cookies.has('offnal_anon')).toBe(true);

    const statusResponse = await getStatus(client, jobId);
    const statusText = await statusResponse.text();
    const expectedYearMonth = nextYearMonth(currentYearMonthInSeoul(new Date()));

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get('cache-control')).toContain('no-store');

    for (const name of MOCK_CANDIDATE_NAMES) {
      expect(statusText).not.toContain(name);
    }

    for (const code of MOCK_CODES) {
      expect(statusText).not.toContain(code);
    }

    expect(statusText).not.toContain(`"${expectedYearMonth}"`);
    expect(statusText).not.toContain('yearMonth');

    const status = JSON.parse(statusText) as RecognitionStatusResponse;

    expect(status).toMatchObject({
      id: jobId,
      status: RecognitionStatus.RECOGNIZED,
      errorCode: null,
      retryable: false,
      ownerAuthenticated: false,
    });

    const anonymousCandidates = await client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, {
      params: { id: jobId },
    });

    expect(anonymousCandidates.status).toBe(401);
    expect((await readJson<ApiErrorBody>(anonymousCandidates)).error.code).toBe(ApiErrorCode.AUTH_REQUIRED);

    const loginResponse = await devLogin(client, '데모 간호사', `/recognitions/${jobId}`);

    expect(loginResponse.status).toBe(303);
    expect(new URL(loginResponse.headers.get('location') ?? '').pathname).toBe(`/recognitions/${jobId}`);
    expect(client.cookies.has('offnal_session')).toBe(true);

    const [job] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, jobId));

    expect(job?.userId).not.toBeNull();

    const claimResponse = await claimJob(client, jobId);

    expect(claimResponse.status).toBe(200);
    expect((await readJson<RecognitionStatusResponse>(claimResponse)).ownerAuthenticated).toBe(true);

    const candidatesResponse = await client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, {
      params: { id: jobId },
    });
    const candidates = await readJson<CandidatesResponse>(candidatesResponse);

    expect(candidatesResponse.status).toBe(200);
    expect(candidates.yearMonthGuess).toBe(expectedYearMonth);
    expect(candidates.candidates.map((candidate) => candidate.name)).toEqual([...MOCK_CANDIDATE_NAMES]);
    expect(candidates.sourceAvailable).toBe(true);

    const sourceResponse = await client.send(sourceRoute, `/api/recognitions/${jobId}/source`, {
      params: { id: jobId },
    });

    expect(sourceResponse.status).toBe(200);
    expect(sourceResponse.headers.get('content-type')).toBe('image/png');
    expect(sourceResponse.headers.get('cache-control')).toContain('no-store');

    const draftId = await extractRow(client, jobId, expectedYearMonth);
    const draft = await readDraft(client, draftId);
    const day14 = draft.draft.entries.find((entry) => entry.date.endsWith('-14'));
    const day20 = draft.draft.entries.find((entry) => entry.date.endsWith('-20'));

    expect(draft.draft.status).toBe(DraftStatus.EDITING);
    expect(draft.draft.displayName).toBe(MOCK_CANDIDATE_NAMES[0]);
    expect(day14?.reviewReasons).toContain(ShiftReviewReason.AMBIGUOUS);
    expect(day20).toMatchObject({ code: null, reviewReasons: [ShiftReviewReason.UNREADABLE] });
    expect(draft.review.count).toBe(2);
    expect(draft.access.monthAccess).toBe(MonthAccess.TRIAL_AVAILABLE);
    expect(draft.access.freeRemaining).toBe(2);
    expect(draft.access.priceKrw).toBe(1900);
    expect(draft.blockers.length).toBeGreaterThan(0);
    expect(draft.sourceCells.find((cell) => cell.date.endsWith('-14'))?.rawText).toBe('E?');

    const patchResponse = await patchDraft(client, draftId, {
      revision: draft.draft.revision,
      entries: resolveEntries(draft.draft.entries),
    });
    const patched = await readJson<DraftResponse>(patchResponse);

    expect(patchResponse.status).toBe(200);
    expect(patched.draft.revision).toBe(draft.draft.revision + 1);
    expect(patched.blockers).toEqual([]);

    const publishResponse = await publishDraft(client, draftId, patched.draft.revision);
    const published = await readJson<PublishDraftResponse>(publishResponse);

    expect(publishResponse.status).toBe(200);
    expect(published).toMatchObject({ draftId, yearMonth: expectedYearMonth, usedTrial: true });

    const trialRows = await env.db
      .select()
      .from(entitlements)
      .where(eq(entitlements.source, EntitlementSource.TRIAL));

    expect(trialRows).toHaveLength(1);

    const summary = await readJson<CalendarSummaryResponse>(
      await client.send(calendarRoute, '/api/calendar'),
    );

    expect(summary.freeRemaining).toBe(1);
    expect(summary.months.map((month) => month.yearMonth)).toEqual([expectedYearMonth]);
  });
});

describe('recognition failure', () => {
  it('reports a retryable failure for a narrow image and allows retry until the attempt limit', async () => {
    const client = createApiTestClient();
    const uploadResponse = await uploadImage(client, await createNarrowPng());

    expect(uploadResponse.status).toBe(201);

    const { id } = await readJson<CreateRecognitionResponse>(uploadResponse);
    const first = await readJson<RecognitionStatusResponse>(await processJob(client, id));

    expect(first).toMatchObject({
      status: RecognitionStatus.FAILED,
      errorCode: RecognitionErrorCode.NO_TABLE,
      retryable: true,
    });

    const second = await readJson<RecognitionStatusResponse>(await processJob(client, id));

    expect(second.status).toBe(RecognitionStatus.FAILED);
    expect(second.retryable).toBe(true);

    const third = await readJson<RecognitionStatusResponse>(await processJob(client, id));

    expect(third.status).toBe(RecognitionStatus.FAILED);
    expect(third.retryable).toBe(false);

    const [job] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, id));

    expect(job?.attemptCount).toBe(3);
    expect(job?.tableResult).toBeNull();

    const afterLimit = await readJson<RecognitionStatusResponse>(await processJob(client, id));

    expect(afterLimit.status).toBe(RecognitionStatus.FAILED);

    const [unchanged] = await env.db.select().from(recognitionJobs).where(eq(recognitionJobs.id, id));

    expect(unchanged?.attemptCount).toBe(3);
  });
});

describe('processing lease', () => {
  // PGlite has a single connection, so the two lease UPDATEs are serialized either way; the atomic
  // conditional UPDATE is what matters on real Postgres (`pnpm test:pg`).
  it('invokes the provider only once for concurrent process calls', async () => {
    const mock = createMockVisionProvider({ delayMs: 30 });
    let recognizeCalls = 0;
    const countingProvider: VisionProvider = {
      kind: mock.kind,
      recognizeTable: async (image, signal) => {
        recognizeCalls += 1;

        return mock.recognizeTable(image, signal);
      },
      extractPerson: mock.extractPerson,
    };

    setVisionProviderForTesting(countingProvider);

    try {
      const client = createApiTestClient();
      const { id } = await readJson<CreateRecognitionResponse>(
        await uploadImage(client, await createTablePng()),
      );
      const responses = await Promise.all([processJob(client, id), processJob(client, id)]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(recognizeCalls).toBe(1);

      const status = await readJson<RecognitionStatusResponse>(await getStatus(client, id));

      expect(status.status).toBe(RecognitionStatus.RECOGNIZED);

      await processJob(client, id);
      expect(recognizeCalls).toBe(1);
    } finally {
      setVisionProviderForTesting(null);
    }
  });
});

describe('extract idempotency and expiry', () => {
  it('returns the same draft for repeated row and manual-name extracts', async () => {
    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    await devLogin(client, '멱등 사용자');

    const first = await extractRow(client, jobId, '2026-11');
    const second = await extractRow(client, jobId, '2026-11');
    const otherMonth = await extractRow(client, jobId, '2026-12');

    expect(second).toBe(first);
    expect(otherMonth).not.toBe(first);

    const sendManual = async (manualName: string): Promise<string> => {
      const response = await client.send(extractRoute, `/api/recognitions/${jobId}/extract`, {
        json: { manualName, yearMonth: '2026-11' },
        params: { id: jobId },
      });

      expect(response.status).toBe(200);

      return (await readJson<ExtractRecognitionResponse>(response)).draftId;
    };

    const manualFirst = await sendManual('직접 입력');
    const manualSecond = await sendManual('직접 입력');
    const manualOther = await sendManual('다른 이름');

    expect(manualSecond).toBe(manualFirst);
    expect(manualOther).not.toBe(manualFirst);

    const manualDraft = await readDraft(client, manualFirst);

    expect(manualDraft.draft.displayName).toBe('직접 입력');
    expect(manualDraft.draft.entries).toHaveLength(30);
    expect(manualDraft.draft.entries.every((entry) => entry.code === null)).toBe(true);
    expect(manualDraft.draft.entries[0]?.reviewReasons).toEqual([ShiftReviewReason.MISSING_DATE]);
    expect(manualDraft.draft.definitions.map((definition) => definition.code)).toContain('N');
  });

  it('rejects an unknown row and an invalid month', async () => {
    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    await devLogin(client, '검증 사용자');

    const unknownRow = await client.send(extractRoute, `/api/recognitions/${jobId}/extract`, {
      json: { rowId: 'nope', yearMonth: '2026-11' },
      params: { id: jobId },
    });
    const invalidMonth = await client.send(extractRoute, `/api/recognitions/${jobId}/extract`, {
      json: { rowId: MOCK_FIRST_ROW_ID, yearMonth: '2026-13' },
      params: { id: jobId },
    });

    expect(unknownRow.status).toBe(400);
    expect(invalidMonth.status).toBe(400);
  });

  it('reports expired jobs as expired and refuses extraction with 410', async () => {
    const client = createApiTestClient();
    const jobId = await uploadAndProcess(client);

    await devLogin(client, '만료 사용자');
    await env.db
      .update(recognitionJobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(recognitionJobs.id, jobId));

    const status = await readJson<RecognitionStatusResponse>(await getStatus(client, jobId));

    expect(status.status).toBe(RecognitionStatus.EXPIRED);

    const extractResponse = await client.send(extractRoute, `/api/recognitions/${jobId}/extract`, {
      json: { rowId: MOCK_FIRST_ROW_ID, yearMonth: '2026-11' },
      params: { id: jobId },
    });

    expect(extractResponse.status).toBe(410);
    expect((await readJson<ApiErrorBody>(extractResponse)).error.code).toBe(ApiErrorCode.EXPIRED);

    const candidatesResponse = await client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, {
      params: { id: jobId },
    });

    expect(candidatesResponse.status).toBe(410);

    const sourceResponse = await client.send(sourceRoute, `/api/recognitions/${jobId}/source`, {
      params: { id: jobId },
    });

    expect(sourceResponse.status).toBe(410);
  });
});

describe('provider image preparation', () => {
  it('downscales large photos to a JPEG copy with a long edge of at most 2576px', async () => {
    const mock = createMockVisionProvider({ delayMs: 0 });
    const seen: { width: number; height: number; format: string; mime: string }[] = [];
    const record = async (bytes: Buffer, mime: string): Promise<void> => {
      const metadata = await sharp(bytes).metadata();

      seen.push({
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? '',
        mime,
      });
    };

    setVisionProviderForTesting({
      kind: mock.kind,
      recognizeTable: async (image, signal) => {
        await record(image.bytes, image.mime);

        return mock.recognizeTable(image, signal);
      },
      extractPerson: async (image, input, signal) => {
        await record(image.bytes, image.mime);

        return mock.extractPerson(image, input, signal);
      },
    });

    try {
      const client = createApiTestClient();
      const original = await createPngFixture(3600, 2400);
      const jobId = await uploadAndProcess(client, original);

      await devLogin(client, '큰 사진 사용자');
      await extractRow(client, jobId, '2026-11');

      expect(seen).toEqual([
        { width: 2576, height: 1717, format: 'jpeg', mime: 'image/jpeg' },
        { width: 2576, height: 1717, format: 'jpeg', mime: 'image/jpeg' },
      ]);

      const stored = await env.storage.get(`sources/${jobId}`);

      expect(stored?.equals(original)).toBe(true);
    } finally {
      setVisionProviderForTesting(null);
    }
  });
});

describe('concurrent extract', () => {
  it('creates one draft, calls the provider once and charges the monthly limit once', async () => {
    const mock = createMockVisionProvider({ delayMs: 20 });
    let extractCalls = 0;

    setVisionProviderForTesting({
      kind: mock.kind,
      recognizeTable: mock.recognizeTable,
      extractPerson: async (image, input, signal) => {
        extractCalls += 1;

        return mock.extractPerson(image, input, signal);
      },
    });

    try {
      const client = createApiTestClient();
      const jobId = await uploadAndProcess(client);

      await devLogin(client, '동시 추출 사용자');

      const [first, second] = await Promise.all([
        extractRow(client, jobId, '2026-11'),
        extractRow(client, jobId, '2026-11'),
      ]);
      const [user] = await env.db.select().from(users).where(eq(users.displayName, '동시 추출 사용자'));
      const rows = await env.db.select().from(drafts).where(eq(drafts.recognitionJobId, jobId));
      const [counter] = await env.db
        .select()
        .from(rateLimitCounters)
        .where(
          eq(
            rateLimitCounters.key,
            buildRateLimitKey({
              scope: RateLimitScope.EXTRACT_USER,
              subject: user?.id ?? '',
              window: RateLimitWindow.MONTHLY,
              limit: 0,
            }),
          ),
        );

      expect(second).toBe(first);
      expect(rows).toHaveLength(1);
      expect(extractCalls).toBe(1);
      expect(counter?.count).toBe(1);
    } finally {
      setVisionProviderForTesting(null);
    }
  });
});

describe('upload compensation', () => {
  it('deletes the stored source when the job insert fails', async () => {
    const sourcesDir = path.join(env.storageDir, 'sources');
    const listSources = async (): Promise<string[]> => readdir(sourcesDir).catch(() => []);
    const before = await listSources();

    await expect(
      createRecognitionJob(env.db, {
        // Unknown user → foreign key violation on insert, after the object was stored.
        userId: randomUUID(),
        anonymousSessionId: null,
        ipHash: 'ip-hash',
        bytes: await createTablePng(),
        mime: ImageMimeType.PNG,
      }),
    ).rejects.toThrow();
    expect(await listSources()).toEqual(before);
  });
});
