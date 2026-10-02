import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { OcrMode } from '@/domain/enums/OcrMode';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { currentYearMonthInSeoul } from '@/domain/YearMonth';
import { type Db } from '@/server/db/Database';
import { ocrShadowRuns, type OcrShadowRunRow } from '@/server/db/Schema';
import { runCleanup } from '@/server/services/CleanupService';
import { runOcrShadow, type OcrShadowDeps, type OcrShadowInput } from '@/server/services/OcrShadowRunner';
import { setOcrShadowOverridesForTesting } from '@/server/services/OcrShadowScheduler';
import { MOCK_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';

import {
  createApiTestClient,
  type IntegrationEnvironment,
  setupIntegrationEnvironment,
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
/** Columns that may hold text: generated ids, the enum status and the error class name. */
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

  it('records a timeout instead of waiting for the engine', async () => {
    const input = await buildInput();
    const hanging = () => new Promise<OcrTableResult>(() => undefined);

    expect(await runOcrShadow(buildDeps({ timeoutMs: 20, readTable: hanging }), input)).toBe(
      OcrShadowStatus.TIMEOUT,
    );
    expect(await findRuns(input.jobId)).toEqual([
      expect.objectContaining({ status: OcrShadowStatus.TIMEOUT, errorName: null, wouldFallback: true }),
    ]);
  });

  it('records only the error class name and never throws or logs the message', async () => {
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
        errorName: 'EngineCrash',
        wouldFallback: true,
      }),
    ]);
    expect((await findRuns(garbage.jobId))[0]?.errorName).toBe('Error');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHADOW_NAME);
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

describe('shadow OCR in the extract route', () => {
  it('does nothing while OCR is off (tests and demo mode)', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, MOCK_CANDIDATE_NAMES[0]!);

    await extractRow(client, jobId, currentYearMonthInSeoul(new Date()));

    expect(await findRuns(jobId)).toEqual([]);
  });

  it('schedules one run after a new draft, with the chosen name and month, and leaves the response alone', async () => {
    const tasks: (() => Promise<void>)[] = [];
    const recognize = vi.fn(async () => ({ text: '', confidence: 0 }));

    setOcrShadowOverridesForTesting({
      config: { ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1 },
      schedule: (task) => {
        tasks.push(task);
      },
      acquireOcr: async () => ({
        provider: fakeOcr(recognize),
        coldStart: true,
        discard: async () => undefined,
      }),
    });

    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, MOCK_CANDIDATE_NAMES[0]!);
    const draftId = await extractRow(client, jobId, currentYearMonthInSeoul(new Date()));

    expect(await extractRow(client, jobId, currentYearMonthInSeoul(new Date()))).toBe(draftId);
    expect(tasks).toHaveLength(1);
    expect(await findRuns(jobId)).toEqual([]);

    await tasks[0]!();

    expect(await findRuns(jobId)).toEqual([
      expect.objectContaining({ status: OcrShadowStatus.TABLE_FAILED, coldStart: true }),
    ]);
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
