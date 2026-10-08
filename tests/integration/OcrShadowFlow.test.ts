import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { OcrMode } from '@/domain/enums/OcrMode';
import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { currentYearMonthInSeoul } from '@/domain/YearMonth';
import { POST as internalRoute } from '@/app/api/internal/ocr-shadow/route';
import { resetAppConfigForTesting } from '@/server/config/AppConfig';
import { type Db } from '@/server/db/Database';
import { drafts, ocrShadowRuns, type OcrShadowRunRow } from '@/server/db/Schema';
import { runCleanup } from '@/server/services/CleanupService';
import {
  type OcrShadowExecutorOptions,
  setOcrShadowExecutorOverridesForTesting,
} from '@/server/services/OcrShadowExecutor';
import { setOcrShadowRouteScheduleForTesting } from '@/server/services/OcrShadowInternalService';
import { OCR_SHADOW_ROUTE_PATH } from '@/server/services/OcrShadowRouteLimits';
import {
  type OcrShadowDeps,
  type OcrShadowInput,
  recordOcrShadowSkip,
  runOcrShadow,
} from '@/server/services/OcrShadowRunner';
import { setOcrShadowOverridesForTesting } from '@/server/services/OcrShadowScheduler';
import { MOCK_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import { OcrEngineError } from '@/server/vision/ocr/OcrEngineError';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { measureOcrTable } from '@/server/vision/ocr/OcrShadowComparison';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';

import {
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createLoggedInJob, extractRow } from '../helpers/OffnalFlows';
import {
  buildAiSchedule,
  buildOcrRow,
  buildOcrTable,
  MIXED_AI_CODES,
  MIXED_OCR_SPECS,
  OTHER_NAME,
  repeatCode,
  SHADOW_MONTH,
  SHADOW_NAME,
} from '../unit/support/OcrShadowFixture';

const GEOMETRY = { quad: null, warped: null, grid: null, headerRow: null };
/** Columns that may hold text: generated ids, the enum status and the enum error kind. */
const TEXT_COLUMNS = new Set(['id', 'jobId', 'status', 'errorName']);

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  setOcrShadowOverridesForTesting(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await env.close();
});

const fakeOcr = (
  recognize: OcrProvider['recognize'] = async () => ({ text: '', confidence: 0 }),
): OcrProvider => ({
  recognize,
  terminate: async () => undefined,
});

const whitePng = (): Promise<Buffer> =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();

const buildInput = async (overrides: Partial<OcrShadowInput> = {}): Promise<OcrShadowInput> => ({
  jobId: randomUUID(),
  sourceBytes: await whitePng(),
  name: SHADOW_NAME,
  yearMonth: SHADOW_MONTH,
  aiSchedule: buildAiSchedule(MIXED_AI_CODES),
  ...overrides,
});

const buildDeps = (overrides: Partial<OcrShadowDeps> = {}): OcrShadowDeps => ({
  db: env.db,
  ocr: fakeOcr(),
  timeoutMs: 5_000,
  coldStart: false,
  ...overrides,
});

const findRuns = (jobId: string): Promise<OcrShadowRunRow[]> =>
  env.db.select().from(ocrShadowRuns).where(eq(ocrShadowRuns.jobId, jobId));

const okTable = (): OcrTableResult => ({
  ok: true,
  table: buildOcrTable([
    buildOcrRow(0, OTHER_NAME, repeatCode('E', 28)),
    buildOcrRow(1, SHADOW_NAME, MIXED_OCR_SPECS),
  ]),
  geometry: GEOMETRY,
  latencyMs: 10,
});

describe('shadow OCR runner', () => {
  it('stores the comparison as numbers only (no names, codes or keys)', async () => {
    const input = await buildInput();
    const clock = [1_000, 1_250];
    const status = await runOcrShadow(
      buildDeps({
        coldStart: true,
        now: () => clock.shift() ?? 0,
        readTable: async () => okTable(),
        readRssMb: () => 321,
      }),
      input,
    );
    const [row] = await findRuns(input.jobId);

    expect(status).toBe(OcrShadowStatus.OK);
    expect(row).toMatchObject({
      status: OcrShadowStatus.OK,
      errorName: null,
      dayCount: 28,
      agreeCells: 23,
      disagreeCells: 1,
      ocrNullCells: 3,
      aiNullCells: 1,
      unresolvedCells: 3,
      reviewCells: 3,
      wouldFallback: true,
      ocrMs: 250,
      coldStart: true,
      rssMb: 321,
    });

    for (const [key, value] of Object.entries(row!)) {
      if (TEXT_COLUMNS.has(key) || key === 'createdAt') {
        continue;
      }

      expect(['number', 'boolean'].includes(typeof value) || value === null, key).toBe(true);
    }

    const serialized = JSON.stringify(row);

    expect(serialized).not.toContain(SHADOW_NAME);
    expect(serialized).not.toContain(OTHER_NAME);
    expect(serialized).not.toMatch(/"(D|E|N)"/u);
  });

  it('runs the real table reader with the injected engine and records an unreadable photo', async () => {
    const recognize = vi.fn(async () => ({ text: '', confidence: 0 }));
    const input = await buildInput();

    expect(await runOcrShadow(buildDeps({ ocr: fakeOcr(recognize) }), input)).toBe(
      OcrShadowStatus.TABLE_FAILED,
    );
    expect(await findRuns(input.jobId)).toEqual([
      expect.objectContaining({
        status: OcrShadowStatus.TABLE_FAILED,
        wouldFallback: true,
        agreeCells: null,
      }),
    ]);
  });

  it('records a missing row as a fallback', async () => {
    const input = await buildInput({ name: '없는사람' });

    expect(await runOcrShadow(buildDeps({ readTable: async () => okTable() }), input)).toBe(
      OcrShadowStatus.ROW_NOT_FOUND,
    );
    expect(await findRuns(input.jobId)).toEqual([
      expect.objectContaining({ status: OcrShadowStatus.ROW_NOT_FOUND, wouldFallback: true, dayCount: null }),
    ]);
  });

  it('records a timeout instead of waiting for the engine and aborts the table reader', async () => {
    const input = await buildInput();
    let seenSignal: AbortSignal | null = null;
    const hanging = (_source: unknown, _ocr: OcrProvider, signal: AbortSignal) => {
      seenSignal = signal;

      return new Promise<OcrTableResult>(() => undefined);
    };

    expect(await runOcrShadow(buildDeps({ timeoutMs: 20, readTable: hanging }), input)).toBe(
      OcrShadowStatus.TIMEOUT,
    );
    expect(seenSignal!.aborted).toBe(true);
    expect(await findRuns(input.jobId)).toEqual([
      expect.objectContaining({ status: OcrShadowStatus.TIMEOUT, errorName: null, wouldFallback: true }),
    ]);
  });

  it('records the engine classification of an OCR failure', async () => {
    const input = await buildInput();
    const failing = async (): Promise<OcrTableResult> => {
      throw new OcrEngineError(OcrShadowErrorKind.WORKER_INIT);
    };

    expect(await runOcrShadow(buildDeps({ readTable: failing }), input)).toBe(OcrShadowStatus.ERROR);
    expect((await findRuns(input.jobId))[0]?.errorName).toBe(OcrShadowErrorKind.WORKER_INIT);
  });

  it('records only a fixed error kind and never throws or logs the message', async () => {
    class EngineCrash extends Error {
      override name = 'EngineCrash';
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input = await buildInput();
    const failing = async (): Promise<OcrTableResult> => {
      throw new EngineCrash(`row of ${SHADOW_NAME}`);
    };

    expect(await runOcrShadow(buildDeps({ readTable: failing }), input)).toBe(OcrShadowStatus.ERROR);

    const garbage = await buildInput({ sourceBytes: Buffer.from('not an image') });

    expect(await runOcrShadow(buildDeps(), garbage)).toBe(OcrShadowStatus.ERROR);
    expect(await findRuns(input.jobId)).toEqual([
      expect.objectContaining({
        status: OcrShadowStatus.ERROR,
        errorName: OcrShadowErrorKind.TABLE,
        wouldFallback: true,
      }),
    ]);
    expect((await findRuns(garbage.jobId))[0]?.errorName).toBe(OcrShadowErrorKind.DECODE);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHADOW_NAME);
  });

  it('stores skipped runs and rejects an error name outside the fixed kinds', async () => {
    const jobId = randomUUID();

    await recordOcrShadowSkip(env.db, jobId, OcrShadowStatus.SKIPPED_BUSY, () => 1);
    await recordOcrShadowSkip(env.db, jobId, OcrShadowStatus.SKIPPED_BUDGET, () => 1);

    expect((await findRuns(jobId)).map((row) => row.status).sort()).toEqual([
      OcrShadowStatus.SKIPPED_BUDGET,
      OcrShadowStatus.SKIPPED_BUSY,
    ]);
    await expect(
      env.db.insert(ocrShadowRuns).values({
        jobId,
        status: OcrShadowStatus.ERROR,
        errorName: 'TypeError' as OcrShadowErrorKind,
        wouldFallback: true,
        ocrMs: 1,
        coldStart: false,
        rssMb: 1,
      }),
    ).rejects.toThrow();
  });

  it('swallows a failing insert', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const brokenDb = {
      insert: () => {
        throw new Error('db down');
      },
    } as unknown as Db;

    await expect(
      runOcrShadow(buildDeps({ db: brokenDb, readTable: async () => okTable() }), await buildInput()),
    ).resolves.toBe(OcrShadowStatus.OK);
  });
});

const INTERNAL_SECRET = 'internal-secret-internal-secret-0123';

/** Shadow mode on, every extract sampled; `fetch` hands the call straight to the internal route. */
const routeShadowCalls = (fetchImpl?: typeof fetch) => {
  const tasks: (() => Promise<void>)[] = [];
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const forward: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });

    return internalRoute(new NextRequest(String(url), init as ConstructorParameters<typeof NextRequest>[1]));
  };

  setOcrShadowOverridesForTesting({
    config: {
      ocrMode: OcrMode.SHADOW,
      ocrShadowSampleRate: 1,
      ocrInternalSecret: INTERNAL_SECRET,
      appUrl: TEST_APP_URL,
    },
    schedule: (task) => {
      tasks.push(task);
    },
    fetch: fetchImpl ?? forward,
    env: {},
  });

  return { tasks, calls };
};

const useFakeEngine = (overrides: Partial<OcrShadowExecutorOptions> = {}) => {
  setOcrShadowExecutorOverridesForTesting({
    acquireOcr: async () => ({ provider: fakeOcr(), coldStart: true, discard: async () => undefined }),
    readRssMb: () => 512,
    ...overrides,
  });
};

/** Runs started by the internal route after its 202 (its `after()`), run by the test. */
let routeTasks: (() => Promise<void>)[] = [];

const captureRouteRuns = (): void => {
  routeTasks = [];
  setOcrShadowRouteScheduleForTesting((task) => {
    routeTasks.push(task);
  });
};

const runRouteTasks = async (): Promise<void> => {
  for (const task of routeTasks.splice(0)) {
    await task();
  }
};

const setInternalSecret = (secret: string | undefined): void => {
  if (secret === undefined) {
    delete process.env.OCR_INTERNAL_SECRET;
  } else {
    process.env.OCR_INTERNAL_SECRET = secret;
  }

  resetAppConfigForTesting();
};

const findDraft = async (draftId: string) => {
  const [draft] = await env.db.select().from(drafts).where(eq(drafts.id, draftId));

  return draft!;
};

const postInternal = (query: string, body: Uint8Array, secret = INTERNAL_SECRET): Promise<Response> =>
  internalRoute(
    new NextRequest(`${TEST_APP_URL}${OCR_SHADOW_ROUTE_PATH}?${query}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(body),
    }),
  );

describe('shadow OCR from the extract route', () => {
  beforeEach(() => {
    setInternalSecret(INTERNAL_SECRET);
    captureRouteRuns();
  });

  afterEach(() => {
    setInternalSecret(undefined);
    setOcrShadowExecutorOverridesForTesting(null);
    setOcrShadowRouteScheduleForTesting(null);
  });

  it('does nothing while OCR is off (tests and demo mode)', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    setOcrShadowOverridesForTesting({ fetch: fetchMock });

    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, MOCK_CANDIDATE_NAMES[0]!);

    await extractRow(client, jobId, currentYearMonthInSeoul(new Date()));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await findRuns(jobId)).toEqual([]);
  });

  it('calls the internal route once per new draft, which compares with the initial entries', async () => {
    const { tasks, calls } = routeShadowCalls();
    const yearMonth = currentYearMonthInSeoul(new Date());
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, MOCK_CANDIDATE_NAMES[0]!);
    const draftId = await extractRow(client, jobId, yearMonth);

    // The same draft again: no second call (no duplicate statistics for one photo and person).
    expect(await extractRow(client, jobId, yearMonth)).toBe(draftId);
    expect(tasks).toHaveLength(1);
    expect(calls).toEqual([]);

    const draft = await findDraft(draftId);
    const initialEntries = draft.initialEntries!;
    const dayCount = initialEntries.length;
    // OCR "reads" the AI codes, then the user edits every day: the comparison must use initial_entries.
    const table: OcrTableResult = {
      ok: true,
      table: {
        ...buildOcrTable([
          buildOcrRow(
            0,
            draft.displayName,
            initialEntries.map((entry) => entry.code),
          ),
        ]),
        yearMonth,
        dayCount,
      },
      geometry: GEOMETRY,
      latencyMs: 10,
    };

    useFakeEngine({ readTable: async () => table });
    await env.db
      .update(drafts)
      .set({ entries: initialEntries.map((entry) => ({ ...entry, code: 'EDITED' })) })
      .where(eq(drafts.id, draftId));
    await tasks[0]!();

    // Acknowledged before the run: nothing recorded until the route's own after() runs.
    expect(calls).toHaveLength(1);
    expect(await findRuns(jobId)).toEqual([]);
    await runRouteTasks();
    expect(new URL(calls[0]!.url).searchParams.get('draftId')).toBe(draftId);
    expect(Buffer.from(calls[0]!.init?.body as Uint8Array).length).toBeGreaterThan(0);

    const expected = measureOcrTable(table, draft.displayName, yearMonth, {
      entries: initialEntries,
      definitions: draft.definitions,
      sourceCells: [],
    });
    const [row] = await findRuns(jobId);

    expect(expected.status).toBe(OcrShadowStatus.OK);
    expect(row).toMatchObject({
      status: OcrShadowStatus.OK,
      dayCount,
      agreeCells: expected.counts!.agreeCells,
      disagreeCells: 0,
      coldStart: true,
      rssMb: 512,
    });
    expect(JSON.stringify(row)).not.toContain(draft.displayName);
  });

  it('keeps the extract response when the call fails, and the route records an engine load failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const failing = routeShadowCalls(async () => Promise.reject(new TypeError('fetch failed')));
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, MOCK_CANDIDATE_NAMES[0]!);

    await extractRow(client, jobId, currentYearMonthInSeoul(new Date()));
    await expect(failing.tasks[0]!()).resolves.toBeUndefined();
    expect(await findRuns(jobId)).toEqual([]);

    const forwarded = routeShadowCalls();
    const other = createApiTestClient();
    const otherJob = await createLoggedInJob(other, MOCK_CANDIDATE_NAMES[0]!);

    useFakeEngine({ acquireOcr: async () => Promise.reject(new Error('engine files missing')) });
    await extractRow(other, otherJob, currentYearMonthInSeoul(new Date()));
    await forwarded.tasks[0]!();
    await runRouteTasks();

    expect(await findRuns(otherJob)).toEqual([
      expect.objectContaining({ status: OcrShadowStatus.ERROR, errorName: OcrShadowErrorKind.UNKNOWN }),
    ]);
  });
});

describe('internal shadow OCR route', () => {
  beforeEach(() => {
    setInternalSecret(INTERNAL_SECRET);
    useFakeEngine();
    captureRouteRuns();
  });

  afterEach(() => {
    setInternalSecret(undefined);
    setOcrShadowExecutorOverridesForTesting(null);
    setOcrShadowRouteScheduleForTesting(null);
  });

  it('answers 404 without the secret and writes nothing', async () => {
    const jobId = randomUUID();
    const response = await postInternal(
      `draftId=${randomUUID()}&jobId=${jobId}`,
      await whitePng(),
      'wrong-secret-wrong-secret-wrong-secret',
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(await findRuns(jobId)).toEqual([]);
  });

  it('refuses an unknown draft, a draft of another job and an oversized body', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, MOCK_CANDIDATE_NAMES[0]!);
    const draftId = await extractRow(client, jobId, currentYearMonthInSeoul(new Date()));
    const png = await whitePng();

    expect((await postInternal(`draftId=${randomUUID()}&jobId=${jobId}`, png)).status).toBe(404);
    expect((await postInternal(`draftId=${draftId}&jobId=${randomUUID()}`, png)).status).toBe(404);
    expect((await postInternal(`draftId=not-a-uuid&jobId=${jobId}`, png)).status).toBe(400);
    expect(
      (await postInternal(`draftId=${draftId}&jobId=${jobId}`, new Uint8Array(4 * 1024 * 1024 + 1))).status,
    ).toBe(413);
    expect(await findRuns(jobId)).toEqual([]);

    expect(routeTasks).toEqual([]);

    const accepted = await postInternal(`draftId=${draftId}&jobId=${jobId}`, png);

    expect(accepted.status).toBe(202);
    expect(await readJson(accepted)).toEqual({ accepted: true });
    expect(await findRuns(jobId)).toEqual([]);
    await runRouteTasks();
    expect(await findRuns(jobId)).toEqual([
      expect.objectContaining({ status: OcrShadowStatus.TABLE_FAILED }),
    ]);
  });

  it('answers a probe with numbers only and stores nothing', async () => {
    const before = await env.db.select().from(ocrShadowRuns);
    const response = await postInternal('probe=1', await whitePng());

    // Synchronous: the numbers are in the response, nothing is left to run.
    expect(routeTasks).toEqual([]);

    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({
      status: OcrShadowStatus.TABLE_FAILED,
      tableFound: false,
      rowCount: 0,
      coldStart: true,
      rssBeforeMb: 512,
      rssAfterMb: 512,
    });
    expect(Object.keys(body).sort()).toEqual([
      'coldStart',
      'errorName',
      'ms',
      'rowCount',
      'rssAfterMb',
      'rssBeforeMb',
      'rssPeakMb',
      'status',
      'tableFound',
    ]);
    expect(await env.db.select().from(ocrShadowRuns)).toHaveLength(before.length);
  });
});

describe('shadow OCR retention', () => {
  it('deletes runs older than 90 days in the cleanup cron', async () => {
    const now = new Date('2026-10-02T00:00:00Z');
    const base = { status: OcrShadowStatus.OK, wouldFallback: false, ocrMs: 1, coldStart: false, rssMb: 1 };
    const oldJob = randomUUID();
    const recentJob = randomUUID();

    await env.db.insert(ocrShadowRuns).values([
      { ...base, jobId: oldJob, createdAt: new Date(now.getTime() - 91 * MS_PER_DAY) },
      { ...base, jobId: recentJob, createdAt: new Date(now.getTime() - 89 * MS_PER_DAY) },
    ]);

    const result = await runCleanup(env.db, env.storage, now);

    expect(result.ocrShadowRunsDeleted).toBeGreaterThanOrEqual(1);
    expect(await findRuns(oldJob)).toEqual([]);
    expect(await findRuns(recentJob)).toHaveLength(1);
  });
});
