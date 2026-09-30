import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionPipelineFallback } from '@/domain/enums/VisionPipelineFallback';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionPipelineRoute } from '@/domain/enums/VisionPipelineRoute';
import { VisionPipelineStep } from '@/domain/enums/VisionPipelineStep';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { parseModelTarget } from '@/server/vision/eval/EvalArgs';
import { type ModelSummary, sortSummaries, summarizeModel } from '@/server/vision/eval/EvalSummary';
import {
  callWithRetry,
  classifyFailure,
  MAX_BACKOFF_MS,
  MAX_RATE_LIMIT_RETRIES,
  ModelUnavailableError,
} from '@/server/vision/eval/EvalCallRetry';
import { runSample } from '@/server/vision/eval/EvalRunner';
import { type EvalCallContext } from '@/server/vision/eval/EvalTypes';
import { type EvalSample, evalTruthSchema } from '@/server/vision/eval/EvalTruth';
import {
  type RowBand,
  type VisionImage,
  type VisionProvider,
  VisionProviderError,
} from '@/server/vision/VisionProvider';

const USAGE = { inputTokens: 1000, outputTokens: 500, thinkingTokens: 100 };
const IMAGE: VisionImage = { bytes: Buffer.from('x'), mime: ImageMimeType.JPEG };

const httpError = (status: number, message = `HTTP ${status}`) =>
  new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR, {
    cause: Object.assign(new Error(message), { status }),
  });

const createContext = (calls = 0): EvalCallContext & { sleep: ReturnType<typeof vi.fn> } => ({
  target: parseModelTarget('gemini-3.7-flash'),
  log: () => undefined,
  state: { calls },
  sleep: vi.fn(async () => undefined),
});

const succeedAfter = (failures: unknown[]) => {
  const queue = [...failures];

  return vi.fn(async () => {
    const next = queue.shift();

    if (next) {
      throw next;
    }

    return { value: 'ok', usage: USAGE };
  });
};

describe('callWithRetry', () => {
  it('backs off on 429/503 and records retries, usage and cost', async () => {
    const context = createContext();
    const result = await callWithRetry(context, succeedAfter([httpError(429), httpError(503)]));

    expect(result.value).toEqual({ value: 'ok', usage: USAGE });
    expect(result.record).toMatchObject({ ok: true, retries: 2, usage: USAGE, failureKind: null });
    expect(result.record.costUsd).toBeCloseTo((1000 * 0.75 + 600 * 3.75) / 1_000_000);
    expect(context.sleep.mock.calls).toEqual([[10_000], [20_000]]);
  });

  it('honours a server retryDelay up to the cap and fails instead of waiting longer', async () => {
    const withDelay = (seconds: number) => httpError(429, `{"retryDelay": "${seconds}s"}`);
    const honoured = createContext();

    await callWithRetry(honoured, succeedAfter([withDelay(37)]));
    expect(honoured.sleep.mock.calls).toEqual([[37_000]]);

    const tooLong = createContext();
    const result = await callWithRetry(tooLong, succeedAfter([withDelay(MAX_BACKOFF_MS / 1000 + 1)]));

    expect(result.record).toMatchObject({ ok: false, failureKind: VisionEvalFailureKind.INFRA });
    expect(result.record.error).toMatch(/over cap/);
    expect(tooLong.sleep).not.toHaveBeenCalled();
  });

  it('gives up after the retry limit and on daily quotas', async () => {
    const exhausted = createContext();
    const failures = Array.from({ length: MAX_RATE_LIMIT_RETRIES + 1 }, () => httpError(503));
    const result = await callWithRetry(exhausted, succeedAfter(failures));

    expect(result.record).toMatchObject({ ok: false, retries: MAX_RATE_LIMIT_RETRIES });
    expect(result.record.failureKind).toBe(VisionEvalFailureKind.INFRA);
    expect(exhausted.sleep).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES);

    const daily = createContext();
    const quota = await callWithRetry(
      daily,
      succeedAfter([httpError(429, 'quotaId: GenerateRequestsPerDayPerProjectPerModel')]),
    );

    expect(quota.record.error).toMatch(/daily quota/);
    expect(daily.sleep).not.toHaveBeenCalled();
  });

  it('treats 400/403/404 as "model unavailable" only on the model\'s first call', async () => {
    const first = createContext();

    await expect(callWithRetry(first, succeedAfter([httpError(404)]))).rejects.toBeInstanceOf(
      ModelUnavailableError,
    );

    const later = createContext(3);
    const result = await callWithRetry(later, succeedAfter([httpError(404)]));

    expect(result.record).toMatchObject({ ok: false, failureKind: VisionEvalFailureKind.INFRA });
    expect(later.state.calls).toBe(4);
  });

  it('classifies unusable model output as a model failure and everything else as infra', () => {
    expect(classifyFailure(new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR))).toBe(
      VisionEvalFailureKind.MODEL,
    );
    expect(
      classifyFailure(
        new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR, { cause: new SyntaxError('bad json') }),
      ),
    ).toBe(VisionEvalFailureKind.MODEL);
    expect(
      classifyFailure(
        new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR, {
          cause: new TypeError('fetch failed'),
        }),
      ),
    ).toBe(VisionEvalFailureKind.INFRA);
    expect(classifyFailure(httpError(429))).toBe(VisionEvalFailureKind.INFRA);
    expect(classifyFailure(new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT))).toBe(
      VisionEvalFailureKind.INFRA,
    );
  });
});

const TRUTH = evalTruthSchema.parse({
  yearMonth: '2026-02',
  allNames: ['가상하나', '가상두울'],
  definitions: { D: { startTime: '07:00', endTime: '16:00', endsNextDay: false } },
  people: {
    가상하나: { '2026-02-01': 'D', '2026-02-02': 'OFF' },
    가상두울: { '2026-02-01': 'OFF', '2026-02-02': 'D' },
  },
});

const SAMPLE: EvalSample = { id: 'synthetic', imagePath: 'unused.jpg', truth: TRUTH };

const OK_TABLE = {
  ok: true as const,
  value: {
    yearMonth: '2026-02',
    candidates: [
      { rowId: 'r1', name: '가상하나' },
      { rowId: 'r2', name: '가상두울' },
    ],
    definitions: [],
    dayHeaders: [],
  },
  usage: USAGE,
};

type ProviderBehavior = {
  table: () => Promise<unknown>;
  /** rowId → cells, or an error to throw. */
  rows: Record<string, { code: string | null }[] | Error>;
  band?: RowBand | null;
  /** Thrown by locateRow instead of returning a band. */
  locateError?: Error;
};

const createProvider = (behavior: ProviderBehavior): VisionProvider => {
  const extractPerson: VisionProvider['extractPerson'] = async (_image, input) => {
    const row = behavior.rows[input.rowId];

    if (row instanceof Error || row === undefined) {
      throw row ?? new Error('unexpected row');
    }

    return {
      yearMonth: input.yearMonth,
      rowId: input.rowId,
      displayName: input.name,
      definitions: [],
      cells: row.map((cell, index) => ({
        day: index + 1,
        rawText: cell.code,
        code: cell.code,
        ambiguous: false,
      })),
      usage: USAGE,
    };
  };

  return {
    kind: VisionProviderType.GEMINI,
    recognizeTable: async () =>
      (await behavior.table()) as Awaited<ReturnType<VisionProvider['recognizeTable']>>,
    extractPerson,
    locateRow: async () => {
      if (behavior.locateError) {
        throw behavior.locateError;
      }

      return { band: behavior.band ?? null, usage: USAGE };
    },
    extractPersonFromStrip: async (strip, _reference, input, signal) => ({
      ...(await extractPerson(strip, input, signal)),
      reading: { rowName: input.name, targetInStrip: true, sameNameOrdinal: null },
    }),
  };
};

const run = async (behavior: ProviderBehavior, repeat: number, people = ['가상하나', '가상두울']) => {
  const [result] = await runSample({
    context: createContext(1),
    provider: createProvider(behavior),
    sample: SAMPLE,
    image: IMAGE,
    people,
    repeat,
  });

  return result!;
};

const PERFECT_ROW = [{ code: 'D' }, { code: 'OFF' }];

describe('runSample + summarizeModel', () => {
  it('scores model failures as 0 end-to-end, excludes infra failures and ranks by it', async () => {
    const runs = [
      // Pass 2 of the second person returns unusable output (model failure).
      await run(
        {
          table: async () => OK_TABLE,
          rows: { r1: PERFECT_ROW, r2: new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR) },
        },
        1,
      ),
      // Pass 1 times out (infra): excluded.
      await run(
        {
          table: async () => {
            throw new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT);
          },
          rows: {},
        },
        2,
      ),
      // Pass 1 says there is no table (model failure).
      await run(
        { table: async () => ({ ok: false, errorCode: RecognitionErrorCode.NO_TABLE }), rows: {} },
        3,
      ),
      // Fully successful run for one person.
      await run({ table: async () => OK_TABLE, rows: { r1: PERFECT_ROW } }, 4, ['가상하나']),
    ];

    expect(runs.map((item) => [item.status, item.failureKind])).toEqual([
      [VisionEvalStatus.FAILED, VisionEvalFailureKind.MODEL],
      [VisionEvalStatus.FAILED, VisionEvalFailureKind.INFRA],
      [VisionEvalStatus.FAILED, VisionEvalFailureKind.MODEL],
      [VisionEvalStatus.OK, null],
    ]);
    expect(runs[0]?.people.map((person) => person.outcome)).toEqual([
      VisionEvalPersonOutcome.SCORED,
      VisionEvalPersonOutcome.MODEL_FAILURE,
    ]);
    expect(runs[1]?.people.every((person) => person.outcome === VisionEvalPersonOutcome.INFRA_FAILURE)).toBe(
      true,
    );

    const summary = summarizeModel('gemini-3.7-flash', runs, null);

    expect(summary).toMatchObject({
      runs: 4,
      okRuns: 1,
      successRate: 0.25,
      modelFailures: 2,
      infraFailures: 1,
      // run 1: 2/4, run 3: 0/4, run 4: 2/2 (run 2 excluded)
      endToEndCorrectDays: 4,
      endToEndDays: 10,
      endToEndAccuracy: 0.4,
      // Fully successful runs only.
      accuracy: 1,
      fullMonthMatches: 1,
      personRuns: 1,
      perPerson: { 'synthetic/가상하나': [2] },
    });
    expect(summary.uploadCostUsd).toBeCloseTo(2 * ((1000 * 0.75 + 600 * 3.75) / 1_000_000));

    const cheaper: ModelSummary = { ...summary, model: 'cheap', uploadCostUsd: 0.0001 };
    const better: ModelSummary = { ...summary, model: 'better', endToEndAccuracy: 0.9, uploadCostUsd: 1 };

    expect(sortSummaries([summary, better, cheaper]).map((item) => item.model)).toEqual([
      'better',
      'cheap',
      'gemini-3.7-flash',
    ]);
  });
});

const UNIT_COST = (1000 * 0.75 + 600 * 3.75) / 1_000_000;

describe('runSample with pipelines', () => {
  const GRID = {
    topLeft: { x: 160, y: 260 },
    topRight: { x: 895, y: 212 },
    bottomRight: { x: 957, y: 695 },
    bottomLeft: { x: 140, y: 720 },
  };

  const createPhoto = async (): Promise<VisionImage> => ({
    bytes: await sharp({ create: { width: 1536, height: 1152, channels: 3, background: '#ffffff' } })
      .jpeg()
      .toBuffer(),
    mime: ImageMimeType.JPEG,
  });

  it('shares pass 1, records every pass-2 call and saves debug images per pipeline', async () => {
    const debug = vi.fn(async (_name: string, _image: VisionImage) => undefined);
    const runs = await runSample({
      context: createContext(1),
      provider: createProvider({
        table: async () => ({ ...OK_TABLE, value: { ...OK_TABLE.value, grid: GRID } }),
        rows: { r1: PERFECT_ROW },
        band: { top: 400, bottom: 450, headerBottom: 120 },
      }),
      sample: SAMPLE,
      image: await createPhoto(),
      people: ['가상하나'],
      repeat: 1,
      pipelines: [VisionPipelineMode.BASELINE, VisionPipelineMode.WARP, VisionPipelineMode.WARP_STRIP],
      debug,
    });

    expect(runs.map((item) => [item.pipeline, item.status, item.warpApplied])).toEqual([
      [VisionPipelineMode.BASELINE, VisionEvalStatus.OK, false],
      [VisionPipelineMode.WARP, VisionEvalStatus.OK, true],
      [VisionPipelineMode.WARP_STRIP, VisionEvalStatus.OK, true],
    ]);
    expect(runs.map((item) => item.people[0]?.route)).toEqual([
      VisionPipelineRoute.ORIGINAL,
      VisionPipelineRoute.WARPED,
      VisionPipelineRoute.STRIP,
    ]);
    // The same pass-1 record is attributed to every pipeline.
    expect(new Set(runs.map((item) => item.tableCall))).toHaveProperty('size', 1);
    expect(runs[2]?.people[0]?.calls.map((call) => call.step)).toEqual([
      VisionPipelineStep.LOCATE_ROW,
      VisionPipelineStep.EXTRACT_STRIP,
    ]);
    expect(debug.mock.calls.map(([name]) => name)).toEqual([
      'grid.jpg',
      'warped.jpg',
      'warp-strip-p1-strip.jpg',
    ]);

    const strip = summarizeModel('gemini-3.7-flash', [runs[2]!], null, VisionPipelineMode.WARP_STRIP);
    const baseline = summarizeModel('gemini-3.7-flash', [runs[0]!], null, VisionPipelineMode.BASELINE);

    expect(strip).toMatchObject({
      pipeline: VisionPipelineMode.WARP_STRIP,
      callsPerUpload: 3,
      routes: { [VisionPipelineRoute.STRIP]: 1 },
      endToEndAccuracy: 1,
    });
    // Pass 1 + locate + strip extract.
    expect(strip.uploadCostUsd).toBeCloseTo(3 * UNIT_COST);
    expect(strip.uploadInputTokens).toBe(3000);
    expect(baseline).toMatchObject({ callsPerUpload: 2 });
    expect(baseline.uploadCostUsd).toBeCloseTo(2 * UNIT_COST);
  });

  it('falls back to the original image without a grid and to the warped table without a row', async () => {
    const noGrid = await runSample({
      context: createContext(1),
      provider: createProvider({ table: async () => OK_TABLE, rows: { r1: PERFECT_ROW } }),
      sample: SAMPLE,
      image: IMAGE,
      people: ['가상하나'],
      repeat: 1,
      pipelines: [VisionPipelineMode.WARP_STRIP],
    });

    expect(noGrid[0]?.people[0]).toMatchObject({
      route: VisionPipelineRoute.ORIGINAL,
      fallback: VisionPipelineFallback.NO_GRID,
    });

    const noRow = await runSample({
      context: createContext(1),
      provider: createProvider({
        table: async () => ({ ...OK_TABLE, value: { ...OK_TABLE.value, grid: GRID } }),
        rows: { r1: PERFECT_ROW },
        band: null,
      }),
      sample: SAMPLE,
      image: await createPhoto(),
      people: ['가상하나'],
      repeat: 1,
      pipelines: [VisionPipelineMode.WARP_STRIP],
    });
    const person = noRow[0]?.people[0];

    expect(person).toMatchObject({
      route: VisionPipelineRoute.WARPED,
      fallback: VisionPipelineFallback.ROW_NOT_FOUND,
      outcome: VisionEvalPersonOutcome.SCORED,
    });
    expect(person?.calls.map((call) => call.step)).toEqual([
      VisionPipelineStep.LOCATE_ROW,
      VisionPipelineStep.EXTRACT,
    ]);
    expect(summarizeModel('m', noRow, null).fallbacks).toEqual({ [VisionPipelineFallback.ROW_NOT_FOUND]: 1 });
  });

  it('fails the person when locateRow fails, even if the pipeline recovered (never scored as OK)', async () => {
    const withGrid = async (locateError: Error) =>
      runSample({
        context: createContext(1),
        provider: createProvider({
          table: async () => ({ ...OK_TABLE, value: { ...OK_TABLE.value, grid: GRID } }),
          rows: { r1: PERFECT_ROW },
          locateError,
        }),
        sample: SAMPLE,
        image: await createPhoto(),
        people: ['가상하나'],
        repeat: 1,
        pipelines: [VisionPipelineMode.WARP_STRIP],
      });

    // Non-fatal (HTTP 400 after the first call): the pipeline falls back and extracts, but the run fails.
    const [recovered] = await withGrid(httpError(400));

    expect(recovered).toMatchObject({
      status: VisionEvalStatus.FAILED,
      failureKind: VisionEvalFailureKind.INFRA,
    });
    expect(recovered?.error).toContain('locate-row');
    expect(recovered?.people[0]).toMatchObject({ outcome: VisionEvalPersonOutcome.INFRA_FAILURE });
    expect(recovered?.people[0]?.calls.map((call) => [call.step, call.ok])).toEqual([
      [VisionPipelineStep.LOCATE_ROW, false],
      [VisionPipelineStep.EXTRACT, true],
    ]);

    // Fatal (timeout): the original VisionProviderError reaches the pipeline, which stops like the service.
    const [timedOut] = await withGrid(new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT));

    expect(timedOut).toMatchObject({
      status: VisionEvalStatus.FAILED,
      failureKind: VisionEvalFailureKind.INFRA,
    });
    expect(timedOut?.people[0]?.calls.map((call) => call.step)).toEqual([VisionPipelineStep.LOCATE_ROW]);

    // A model-attributable locate failure (unusable output) scores 0 end-to-end.
    const [unusable] = await withGrid(new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR));

    expect(unusable).toMatchObject({
      status: VisionEvalStatus.FAILED,
      failureKind: VisionEvalFailureKind.MODEL,
    });
    expect(summarizeModel('m', [unusable!], null)).toMatchObject({
      endToEndCorrectDays: 0,
      modelFailures: 1,
    });
  });
});
