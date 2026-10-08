import { afterEach, describe, expect, it, vi } from 'vitest';

import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { maxDuration } from '@/app/api/internal/ocr-shadow/route';
import { type Db } from '@/server/db/Database';
import {
  MIN_OCR_BUDGET_MS,
  OCR_BUDGET_SAFETY_MS,
  executeOcrShadow,
  type OcrShadowExecutorOptions,
  probeOcrShadow,
  resolveOcrShadowTimeout,
} from '@/server/services/OcrShadowExecutor';
import { OCR_SHADOW_MAX_DURATION_SECONDS } from '@/server/services/OcrShadowRouteLimits';
import { type ServiceOcr } from '@/server/vision/ocr/OcrServiceEngine';
import { type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';

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
} from './support/OcrShadowFixture';

const INPUT = {
  jobId: '00000000-0000-4000-8000-000000000001',
  sourceBytes: Buffer.from('jpeg'),
  name: SHADOW_NAME,
  yearMonth: SHADOW_MONTH,
  aiSchedule: buildAiSchedule(MIXED_AI_CODES),
};
const STARTED_AT = 1_000_000;
const ROUTE_BUDGET_MS = OCR_SHADOW_MAX_DURATION_SECONDS * 1000;
const GEOMETRY = { quad: null, warped: null, grid: null, headerRow: null };

/** Captures inserted rows (the runner and the skip recorder only call `insert().values()`). */
const recordingDb = () => {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        rows.push(values);
      },
    }),
  } as unknown as Db;

  return { db, rows };
};

const fakeEngine = (overrides: Partial<ServiceOcr> = {}): ServiceOcr => ({
  provider: { recognize: async () => ({ text: '', confidence: 0 }), terminate: async () => undefined },
  coldStart: false,
  discard: vi.fn(async () => undefined),
  ...overrides,
});

const baseOptions = (
  overrides: Partial<OcrShadowExecutorOptions> = {},
): Partial<OcrShadowExecutorOptions> => ({
  ocrTimeoutMs: 60_000,
  acquireOcr: async () => fakeEngine(),
  now: () => STARTED_AT,
  readRssMb: () => 100,
  ...overrides,
});

const okTable = (): OcrTableResult => ({
  ok: true,
  table: buildOcrTable([
    buildOcrRow(0, OTHER_NAME, repeatCode('E', 28)),
    buildOcrRow(1, SHADOW_NAME, MIXED_OCR_SPECS),
  ]),
  geometry: GEOMETRY,
  latencyMs: 10,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shadow OCR time budget', () => {
  it('uses the internal route maxDuration', () => {
    expect(maxDuration).toBe(OCR_SHADOW_MAX_DURATION_SECONDS);
  });

  it('caps the timeout by what is left of maxDuration minus the safety margin', () => {
    expect(resolveOcrShadowTimeout(60_000, STARTED_AT, STARTED_AT + 5_000)).toBe(60_000);

    const lateStart = STARTED_AT + ROUTE_BUDGET_MS - OCR_BUDGET_SAFETY_MS - 40_000;

    expect(resolveOcrShadowTimeout(60_000, STARTED_AT, lateStart)).toBe(40_000);
    expect(
      resolveOcrShadowTimeout(
        60_000,
        STARTED_AT,
        STARTED_AT + ROUTE_BUDGET_MS - OCR_BUDGET_SAFETY_MS - MIN_OCR_BUDGET_MS,
      ),
    ).toBe(MIN_OCR_BUDGET_MS);
    expect(
      resolveOcrShadowTimeout(
        60_000,
        STARTED_AT,
        STARTED_AT + ROUTE_BUDGET_MS - OCR_BUDGET_SAFETY_MS - MIN_OCR_BUDGET_MS + 1,
      ),
    ).toBeNull();
  });

  it('records skipped_budget without starting the engine when too little time is left', async () => {
    const { db, rows } = recordingDb();
    const acquireOcr = vi.fn(async () => fakeEngine());

    expect(
      await executeOcrShadow(
        db,
        INPUT,
        STARTED_AT,
        baseOptions({ acquireOcr, now: () => STARTED_AT + 280_000 }),
      ),
    ).toBe(OcrShadowStatus.SKIPPED_BUDGET);
    expect(acquireOcr).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({
        jobId: INPUT.jobId,
        status: OcrShadowStatus.SKIPPED_BUDGET,
        errorName: null,
        wouldFallback: true,
        ocrMs: 0,
        agreeCells: null,
      }),
    ]);
  });
});

describe('shadow OCR concurrency', () => {
  it('records skipped_busy while another run is in flight, then runs again once it is done', async () => {
    const { db, rows } = recordingDb();
    let releaseFirst: (engine: ServiceOcr) => void = () => undefined;
    const acquireOcr = vi
      .fn<() => Promise<ServiceOcr>>()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockImplementation(async () => fakeEngine());
    const options = baseOptions({ acquireOcr });

    const first = executeOcrShadow(db, INPUT, STARTED_AT, options);

    expect(
      await executeOcrShadow(
        db,
        { ...INPUT, jobId: '00000000-0000-4000-8000-000000000002' },
        STARTED_AT,
        options,
      ),
    ).toBe(OcrShadowStatus.SKIPPED_BUSY);
    // A probe shares the slot.
    expect((await probeOcrShadow(INPUT.sourceBytes, STARTED_AT, options)).status).toBe(
      OcrShadowStatus.SKIPPED_BUSY,
    );
    expect(rows).toEqual([expect.objectContaining({ status: OcrShadowStatus.SKIPPED_BUSY })]);
    expect(acquireOcr).toHaveBeenCalledTimes(1);

    releaseFirst(fakeEngine());

    // 'jpeg' is not an image: the first run fails while decoding.
    expect(await first).toBe(OcrShadowStatus.ERROR);
    expect(rows[1]).toMatchObject({
      jobId: INPUT.jobId,
      status: OcrShadowStatus.ERROR,
      errorName: OcrShadowErrorKind.DECODE,
    });

    expect(await executeOcrShadow(db, INPUT, STARTED_AT, options)).toBe(OcrShadowStatus.ERROR);
    expect(acquireOcr).toHaveBeenCalledTimes(2);
  });

  it('discards the engine after an error and records an engine load failure as error/unknown', async () => {
    const { db, rows } = recordingDb();
    const engine = fakeEngine();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const acquireOcr = vi
      .fn<() => Promise<ServiceOcr>>()
      .mockResolvedValueOnce(engine)
      .mockRejectedValueOnce(new Error(`engine of ${SHADOW_NAME}`))
      .mockResolvedValue(fakeEngine());
    const options = baseOptions({ acquireOcr });

    for (let index = 0; index < 3; index += 1) {
      await executeOcrShadow(db, INPUT, STARTED_AT, options);
    }

    expect(engine.discard).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SHADOW_NAME);
    expect(acquireOcr).toHaveBeenCalledTimes(3);
    expect(rows[1]).toMatchObject({ status: OcrShadowStatus.ERROR, errorName: OcrShadowErrorKind.UNKNOWN });
  });
});

describe('shadow OCR probe', () => {
  it('returns numbers only (no names or codes) and stores nothing', async () => {
    const samples = [100, 900, 1200, 400];
    const readRssMb = () => samples.shift() ?? 400;
    const clock = [STARTED_AT, STARTED_AT, STARTED_AT + 2_500];
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();

    const result = await probeOcrShadow(
      png,
      STARTED_AT,
      baseOptions({
        acquireOcr: async () => fakeEngine({ coldStart: true }),
        readTable: async () => okTable(),
        readRssMb,
        now: () => clock.shift() ?? STARTED_AT + 2_500,
      }),
    );

    expect(result).toEqual({
      status: OcrShadowStatus.OK,
      errorName: null,
      ms: 2_500,
      coldStart: true,
      rssBeforeMb: 100,
      rssAfterMb: 400,
      rssPeakMb: 1200,
      tableFound: true,
      rowCount: 2,
    });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(SHADOW_NAME);
    expect(serialized).not.toContain(OTHER_NAME);
    expect(serialized).not.toMatch(/"(D|E|N)"/u);

    for (const value of Object.values(result)) {
      expect(['number', 'boolean', 'string'].includes(typeof value) || value === null).toBe(true);
    }
  });

  it('reports an unreadable photo and an engine load failure without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const garbage = await probeOcrShadow(Buffer.from('not an image'), STARTED_AT, baseOptions());

    expect(garbage).toMatchObject({
      status: OcrShadowStatus.ERROR,
      errorName: OcrShadowErrorKind.DECODE,
      tableFound: false,
      rowCount: 0,
    });

    const noEngine = await probeOcrShadow(
      Buffer.from('x'),
      STARTED_AT,
      baseOptions({ acquireOcr: async () => Promise.reject(new Error('no engine')) }),
    );

    expect(noEngine).toMatchObject({ status: OcrShadowStatus.ERROR, errorName: OcrShadowErrorKind.UNKNOWN });
  });
});
