import { describe, expect, it, vi } from 'vitest';

import { OcrMode } from '@/domain/enums/OcrMode';
import { OcrShadowErrorKind } from '@/domain/enums/OcrShadowErrorKind';
import { OcrShadowStatus } from '@/domain/enums/OcrShadowStatus';
import { maxDuration } from '@/app/api/recognitions/[id]/extract/route';
import { type Db } from '@/server/db/Database';
import { EXTRACT_MAX_DURATION_SECONDS } from '@/server/services/ExtractRouteLimits';
import {
  MIN_OCR_BUDGET_MS,
  OCR_BUDGET_SAFETY_MS,
  resolveOcrShadowTimeout,
  scheduleOcrShadow,
  shouldRunOcrShadow,
} from '@/server/services/OcrShadowScheduler';
import { resolveOcrPoolSize, type ServiceOcr } from '@/server/vision/ocr/OcrServiceEngine';

import { buildAiSchedule, MIXED_AI_CODES, SHADOW_MONTH, SHADOW_NAME } from './support/OcrShadowFixture';

const INPUT = {
  jobId: '00000000-0000-4000-8000-000000000001',
  sourceBytes: Buffer.from('jpeg'),
  name: SHADOW_NAME,
  yearMonth: SHADOW_MONTH,
  aiSchedule: buildAiSchedule(MIXED_AI_CODES),
};
const FAKE_DB = {} as Db;
const SHADOW_CONFIG = { ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1, ocrTimeoutMs: 60_000 };
const STARTED_AT = 1_000_000;
const ROUTE_BUDGET_MS = EXTRACT_MAX_DURATION_SECONDS * 1000;

type Task = () => Promise<void>;

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

describe('shadow OCR gate', () => {
  it('runs only in shadow mode and only for the sampled share', () => {
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.OFF, ocrShadowSampleRate: 1 }, () => 0)).toBe(false);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 1 }, () => 0.999)).toBe(true);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0 }, () => 0)).toBe(false);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.3 }, () => 0.29)).toBe(true);
    expect(shouldRunOcrShadow({ ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.3 }, () => 0.3)).toBe(false);
  });

  it('schedules nothing when off or not sampled, and never throws when scheduling fails', () => {
    const schedule = vi.fn();

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, STARTED_AT, {
        config: { ocrMode: OcrMode.OFF, ocrShadowSampleRate: 1 },
        schedule,
      }),
    ).toBe(false);
    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, STARTED_AT, {
        config: { ocrMode: OcrMode.SHADOW, ocrShadowSampleRate: 0.5 },
        random: () => 0.9,
        schedule,
      }),
    ).toBe(false);
    expect(schedule).not.toHaveBeenCalled();

    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, STARTED_AT, {
        config: SHADOW_CONFIG,
        schedule: () => {
          throw new Error('outside a request scope');
        },
      }),
    ).toBe(false);
    expect(
      scheduleOcrShadow(FAKE_DB, INPUT, STARTED_AT, {
        config: SHADOW_CONFIG,
        random: () => {
          throw new Error('broken random');
        },
        schedule,
      }),
    ).toBe(false);
    expect(scheduleOcrShadow(FAKE_DB, INPUT, STARTED_AT, { config: SHADOW_CONFIG, schedule })).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('uses one worker per language on Vercel', () => {
    expect(resolveOcrPoolSize({ VERCEL: '1' })).toBe(1);
    expect(resolveOcrPoolSize({})).toBeGreaterThan(1);
  });
});

describe('shadow OCR time budget', () => {
  it('shares the extract route maxDuration', () => {
    expect(maxDuration).toBe(EXTRACT_MAX_DURATION_SECONDS);
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
    const tasks: Task[] = [];
    const acquireOcr = vi.fn(async () => fakeEngine());

    scheduleOcrShadow(db, INPUT, STARTED_AT, {
      config: SHADOW_CONFIG,
      schedule: (task) => tasks.push(task),
      acquireOcr,
      now: () => STARTED_AT + 280_000,
    });
    await tasks[0]!();

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
    const tasks: Task[] = [];
    let releaseFirst: (engine: ServiceOcr) => void = () => undefined;
    const firstEngine = fakeEngine();
    const acquireOcr = vi
      .fn<() => Promise<ServiceOcr>>()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockImplementation(async () => fakeEngine());
    const options = {
      config: SHADOW_CONFIG,
      schedule: (task: Task) => tasks.push(task),
      acquireOcr,
      now: () => STARTED_AT,
    };

    scheduleOcrShadow(db, INPUT, STARTED_AT, options);
    scheduleOcrShadow(db, { ...INPUT, jobId: '00000000-0000-4000-8000-000000000002' }, STARTED_AT, options);

    const first = tasks[0]!();

    await tasks[1]!();

    expect(rows).toEqual([expect.objectContaining({ status: OcrShadowStatus.SKIPPED_BUSY })]);
    expect(acquireOcr).toHaveBeenCalledTimes(1);

    releaseFirst(firstEngine);
    await first;

    // 'jpeg' is not an image: the first run fails while decoding.
    expect(rows[1]).toMatchObject({
      jobId: INPUT.jobId,
      status: OcrShadowStatus.ERROR,
      errorName: OcrShadowErrorKind.DECODE,
    });

    scheduleOcrShadow(db, INPUT, STARTED_AT, options);
    await tasks[2]!();

    expect(acquireOcr).toHaveBeenCalledTimes(2);
    expect(rows[2]).toMatchObject({ status: OcrShadowStatus.ERROR });
  });

  it('discards the engine after an error and releases the slot when start-up throws', async () => {
    const { db } = recordingDb();
    const tasks: Task[] = [];
    const engine = fakeEngine();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const acquireOcr = vi
      .fn<() => Promise<ServiceOcr>>()
      .mockResolvedValueOnce(engine)
      .mockRejectedValueOnce(new Error('start failed'))
      .mockResolvedValue(fakeEngine());
    const options = {
      config: SHADOW_CONFIG,
      schedule: (task: Task) => tasks.push(task),
      acquireOcr,
      now: () => STARTED_AT,
    };

    for (let index = 0; index < 3; index += 1) {
      scheduleOcrShadow(db, INPUT, STARTED_AT, options);
      await tasks[index]!();
    }

    expect(engine.discard).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(acquireOcr).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});
