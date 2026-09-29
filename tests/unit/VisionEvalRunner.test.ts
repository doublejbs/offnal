import { describe, expect, it, vi } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { parseModelTarget } from '@/server/vision/eval/EvalArgs';
import { type ModelSummary, sortSummaries, summarizeModel } from '@/server/vision/eval/EvalReport';
import {
  callWithRetry,
  classifyFailure,
  type EvalCallContext,
  MAX_BACKOFF_MS,
  MAX_RATE_LIMIT_RETRIES,
  ModelUnavailableError,
  runSample,
} from '@/server/vision/eval/EvalRunner';
import { type EvalSample, evalTruthSchema } from '@/server/vision/eval/EvalTruth';
import { type VisionImage, type VisionProvider, VisionProviderError } from '@/server/vision/VisionProvider';

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
};

const createProvider = (behavior: ProviderBehavior): VisionProvider => ({
  kind: VisionProviderType.GEMINI,
  recognizeTable: async () =>
    (await behavior.table()) as Awaited<ReturnType<VisionProvider['recognizeTable']>>,
  extractPerson: async (_image, input) => {
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
  },
});

const run = (behavior: ProviderBehavior, repeat: number, people = ['가상하나', '가상두울']) =>
  runSample({
    context: createContext(1),
    provider: createProvider(behavior),
    sample: SAMPLE,
    image: IMAGE,
    people,
    repeat,
  });

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
      perPerson: { 가상하나: [2] },
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
