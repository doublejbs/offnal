import { setTimeout as sleepFor } from 'node:timers/promises';

import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { type VisionPipelineFallback } from '@/domain/enums/VisionPipelineFallback';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { type VisionPipelineRoute } from '@/domain/enums/VisionPipelineRoute';
import { VisionPipelineStep } from '@/domain/enums/VisionPipelineStep';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type GridCorners } from '@/domain/types/GridCorners';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { type EvalModelTarget } from '@/server/vision/eval/EvalArgs';
import { renderGridOverlay } from '@/server/vision/eval/EvalDebugImages';
import {
  findCandidateRowId,
  type PersonScore,
  scorePerson,
  scoreTable,
  type TableScore,
} from '@/server/vision/eval/EvalScoring';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import { estimateCostUsd } from '@/server/vision/eval/ModelPrices';
import {
  extractPersonWithPipeline,
  type PipelineCallRunner,
  type PreparedPipelineImage,
  preparePipelineImage,
} from '@/server/vision/VisionPipeline';
import {
  getProviderErrorStatus,
  type VisionImage,
  type VisionProvider,
  VisionProviderError,
  type VisionUsage,
} from '@/server/vision/VisionProvider';

const CALL_TIMEOUT_MS = 240_000;

export const MAX_RATE_LIMIT_RETRIES = 5;

const BASE_BACKOFF_MS = 10_000;

export const MAX_BACKOFF_MS = 120_000;

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MODEL_UNAVAILABLE_STATUSES = new Set([400, 403, 404]);

export type CallRecord = {
  /** Pass-2 pipeline step; absent for pass 1. */
  step?: VisionPipelineStep;
  ok: boolean;
  latencyMs: number;
  retries: number;
  usage: VisionUsage | null;
  costUsd: number | null;
  error: string | null;
  failureKind: VisionEvalFailureKind | null;
};

export type PersonRun = {
  score: PersonScore;
  outcome: VisionEvalPersonOutcome;
  /** Final extract call (null when the name was not found or pass 1 failed). */
  call: CallRecord | null;
  /** Every pass-2 call of this person in order (locate + extract), for tokens, cost and latency. */
  calls: CallRecord[];
  route: VisionPipelineRoute | null;
  fallback: VisionPipelineFallback | null;
};

export type EvalRun = {
  model: string;
  pipeline: VisionPipelineMode;
  sampleId: string;
  repeat: number;
  status: VisionEvalStatus;
  error: string | null;
  /** Kind of the first failure in this run, null when OK. */
  failureKind: VisionEvalFailureKind | null;
  tableCall: CallRecord | null;
  table: TableScore | null;
  /** Pass-1 grid corners (null when not returned). */
  grid: GridCorners | null;
  /** Whether the warped table was usable for this run (always false for baseline). */
  warpApplied: boolean;
  people: PersonRun[];
};

/** Thrown when the model's first call gets 400/403/404: the id is not usable with this key, so skip it. */
export class ModelUnavailableError extends Error {
  /** Short form for the results table, e.g. `provider_error (HTTP 404)`. */
  readonly summary: string;

  constructor(summary: string, detail: string) {
    super(`${summary}: ${detail}`);
    this.name = 'ModelUnavailableError';
    this.summary = summary;
  }
}

type Logger = (line: string) => void;

/** Per-model context shared by all its calls (sequential within one model). */
export type EvalCallContext = {
  target: EvalModelTarget;
  log: Logger;
  /** Calls made so far for this model; "model unavailable" is only decided on the first one. */
  state: { calls: number };
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<unknown>;
};

const describeCause = (error: unknown): string => {
  const cause = error instanceof VisionProviderError ? error.cause : error;

  return cause instanceof Error ? cause.message : String(cause);
};

const describeFailure = (error: unknown): string => {
  const status = getProviderErrorStatus(error);
  const code = error instanceof VisionProviderError ? error.errorCode : 'error';

  return status === null ? code : `${code} (HTTP ${status})`;
};

/**
 * MODEL: the provider answered but the output was unusable (MAX_TOKENS/blocked/non-STOP, invalid JSON,
 * schema mismatch) — adapters throw PROVIDER_ERROR without an HTTP status and without a network cause.
 * Everything else (HTTP errors, timeouts, network, missing key) is INFRA.
 */
export const classifyFailure = (error: unknown): VisionEvalFailureKind => {
  if (
    error instanceof VisionProviderError &&
    error.errorCode === RecognitionErrorCode.PROVIDER_ERROR &&
    getProviderErrorStatus(error) === null &&
    (error.cause === undefined || error.cause instanceof SyntaxError)
  ) {
    return VisionEvalFailureKind.MODEL;
  }

  return VisionEvalFailureKind.INFRA;
};

/** Server-suggested wait from a Gemini 429 body (`"retryDelay": "37s"`), in ms. */
const readRetryDelayMs = (error: unknown): number | null => {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/u.exec(describeCause(error));

  return match?.[1] ? Math.ceil(Number(match[1]) * 1000) : null;
};

/** Daily quotas do not recover within a run; retrying only burns time. */
const isDailyQuota = (error: unknown): boolean => /PerDay/u.test(describeCause(error));

type TimedCall<T> = { value: T | null; record: CallRecord };

const failedRecord = (latencyMs: number, retries: number, error: string, kind: VisionEvalFailureKind) => ({
  ok: false,
  latencyMs,
  retries,
  usage: null,
  costUsd: null,
  error,
  failureKind: kind,
});

/**
 * One provider call with exponential backoff on rate limits and transient 5xx. The server's
 * `retryDelay` is honoured only up to MAX_BACKOFF_MS; a longer one fails the call instead of stalling.
 * Failures are recorded with their kind (never scored as success).
 */
export const callWithRetry = async <T extends { usage?: VisionUsage }>(
  context: EvalCallContext,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<TimedCall<T>> => {
  const { target, log, state } = context;
  const sleep = context.sleep ?? sleepFor;
  const isFirstModelCall = state.calls === 0;

  state.calls += 1;

  for (let attempt = 0; ; attempt += 1) {
    const startedAt = performance.now();

    try {
      const value = await run(AbortSignal.timeout(CALL_TIMEOUT_MS));
      const usage = value.usage ?? null;

      return {
        value,
        record: {
          ok: true,
          latencyMs: Math.round(performance.now() - startedAt),
          retries: attempt,
          usage,
          costUsd: usage ? estimateCostUsd(target.model, usage) : null,
          error: null,
          failureKind: null,
        },
      };
    } catch (error: unknown) {
      const latencyMs = Math.round(performance.now() - startedAt);
      const status = getProviderErrorStatus(error);

      if (isFirstModelCall && attempt === 0 && status !== null && MODEL_UNAVAILABLE_STATUSES.has(status)) {
        throw new ModelUnavailableError(describeFailure(error), describeCause(error).slice(0, 300));
      }

      const kind = classifyFailure(error);

      if (isDailyQuota(error)) {
        return {
          value: null,
          record: failedRecord(latencyMs, attempt, `${describeFailure(error)} daily quota`, kind),
        };
      }

      const retryable = status !== null && RETRYABLE_STATUSES.has(status);

      if (!retryable || attempt >= MAX_RATE_LIMIT_RETRIES) {
        return { value: null, record: failedRecord(latencyMs, attempt, describeFailure(error), kind) };
      }

      const serverDelayMs = readRetryDelayMs(error);

      if (serverDelayMs !== null && serverDelayMs > MAX_BACKOFF_MS) {
        return {
          value: null,
          record: failedRecord(
            latencyMs,
            attempt,
            `${describeFailure(error)} retryDelay ${serverDelayMs / 1000}s over cap`,
            kind,
          ),
        };
      }

      const waitMs = Math.max(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt), serverDelayMs ?? 0);

      log(
        `[${target.label}] HTTP ${status}, retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} in ${waitMs / 1000}s`,
      );
      await sleep(waitMs);
    }
  }
};

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const toPersonOutcome = (record: CallRecord): VisionEvalPersonOutcome => {
  if (record.ok) {
    return VisionEvalPersonOutcome.SCORED;
  }

  return record.failureKind === VisionEvalFailureKind.MODEL
    ? VisionEvalPersonOutcome.MODEL_FAILURE
    : VisionEvalPersonOutcome.INFRA_FAILURE;
};

/** Receives debug images (warped table, strips) of a run; the eval writes them under `.data/`. */
export type EvalDebugSink = (fileName: string, image: VisionImage) => Promise<void>;

export type RunSampleInput = {
  context: EvalCallContext;
  provider: VisionProvider;
  sample: EvalSample;
  image: VisionImage;
  people: string[];
  repeat: number;
  /** Pipelines compared on the same pass-1 result (default: baseline only). */
  pipelines?: VisionPipelineMode[];
  debug?: EvalDebugSink;
};

/** A pass-2 call that failed after retries (its record is already kept). */
class EvalCallFailure extends Error {
  readonly record: CallRecord;

  constructor(record: CallRecord) {
    super(record.error ?? 'call failed');
    this.name = 'EvalCallFailure';
    this.record = record;
  }
}

const isExtractStep = (record: CallRecord): boolean =>
  record.step === VisionPipelineStep.EXTRACT || record.step === VisionPipelineStep.EXTRACT_STRIP;

type PersonContext = {
  input: RunSampleInput;
  table: TableRecognition;
  prepared: PreparedPipelineImage;
  name: string;
  index: number;
};

const runPerson = async ({ input, table, prepared, name, index }: PersonContext): Promise<PersonRun> => {
  const { context, provider, sample, repeat, debug } = input;
  const { truth } = sample;
  const label = `[${context.target.label}] ${sample.id} #${repeat} ${prepared.mode} pass2 ${name}`;
  const rowId = findCandidateRowId(table.candidates, name);

  if (rowId === null) {
    // Missing name: the model's miss, scored as all days wrong.
    return {
      score: scorePerson(truth, name, null, null),
      outcome: VisionEvalPersonOutcome.SCORED,
      call: null,
      calls: [],
      route: null,
      fallback: null,
    };
  }

  const candidateName = table.candidates.find((candidate) => candidate.rowId === rowId)?.name ?? name;
  const calls: CallRecord[] = [];
  const runCall: PipelineCallRunner = async (step, run) => {
    const result = await callWithRetry(context, run);

    calls.push({ ...result.record, step });

    if (result.value === null) {
      throw new EvalCallFailure(result.record);
    }

    return result.value;
  };

  try {
    const result = await extractPersonWithPipeline(
      provider,
      prepared,
      { rowId, name: candidateName, yearMonth: truth.yearMonth, definitions: table.definitions },
      runCall,
    );
    const score = scorePerson(truth, name, rowId, normalizeExtraction(result.extraction, truth.yearMonth));

    if (result.strip && debug) {
      await debug(`${prepared.mode}-p${index + 1}-strip.jpg`, result.strip);
    }

    const latencyMs = calls.reduce((sum, call) => sum + call.latencyMs, 0);

    context.log(
      `${label} ${score.correctDays}/${score.totalDays} via ${result.route}${
        result.fallback ? ` (fallback ${result.fallback})` : ''
      } ${formatSeconds(latencyMs)}`,
    );

    return {
      score,
      outcome: VisionEvalPersonOutcome.SCORED,
      call: calls.findLast(isExtractStep) ?? null,
      calls,
      route: result.route,
      fallback: result.fallback,
    };
  } catch (error: unknown) {
    if (!(error instanceof EvalCallFailure)) {
      throw error;
    }

    context.log(`${label} FAILED (${error.record.failureKind}) ${error.record.error}`);

    return {
      score: scorePerson(truth, name, rowId, null),
      outcome: toPersonOutcome(error.record),
      call: error.record,
      calls,
      route: null,
      fallback: null,
    };
  }
};

const failedPersonRun = (truth: EvalSample['truth'], name: string, outcome: VisionEvalPersonOutcome) => ({
  score: scorePerson(truth, name, null, null),
  outcome,
  call: null,
  calls: [],
  route: null,
  fallback: null,
});

/**
 * Same flow as the service: pass 1 once (shared by every compared pipeline), then pass 2 per scored person
 * and pipeline with the matching candidate row and the pass-1 legend, normalized with the true
 * (user-chosen) month. Returns one run per pipeline.
 */
export const runSample = async (input: RunSampleInput): Promise<EvalRun[]> => {
  const { context, provider, sample, image, people, repeat, debug } = input;
  const pipelines = input.pipelines ?? [VisionPipelineMode.BASELINE];
  const { target, log } = context;
  const { truth } = sample;
  const base = { model: target.label, sampleId: sample.id, repeat };
  const pass1 = await callWithRetry(context, (signal) => provider.recognizeTable(image, signal));
  const tableResult = pass1.value;

  if (!tableResult || !tableResult.ok) {
    // A no_table/unreadable/no_names outcome is the model's reading, not an outage.
    const outcomeFailure = tableResult && !tableResult.ok ? tableResult.errorCode : null;
    const failureKind = outcomeFailure
      ? VisionEvalFailureKind.MODEL
      : (pass1.record.failureKind ?? VisionEvalFailureKind.INFRA);
    const error = outcomeFailure ?? pass1.record.error;
    const outcome =
      failureKind === VisionEvalFailureKind.MODEL
        ? VisionEvalPersonOutcome.MODEL_FAILURE
        : VisionEvalPersonOutcome.INFRA_FAILURE;

    log(`[${target.label}] ${sample.id} #${repeat} pass1 FAILED (${failureKind}) ${error}`);

    return pipelines.map((pipeline) => ({
      ...base,
      pipeline,
      status: VisionEvalStatus.FAILED,
      error: `pass1: ${error}`,
      failureKind,
      tableCall: pass1.record,
      table: scoreTable(truth, null),
      grid: null,
      warpApplied: false,
      people: people.map((name) => failedPersonRun(truth, name, outcome)),
    }));
  }

  const table = tableResult.value;
  const grid = table.grid ?? null;
  // One warp per run, shared by the warp pipelines (same pass-1 corners).
  const warped = pipelines.some((pipeline) => pipeline !== VisionPipelineMode.BASELINE)
    ? await preparePipelineImage(VisionPipelineMode.WARP, image, grid)
    : null;

  log(
    `[${target.label}] ${sample.id} #${repeat} pass1 ok ${formatSeconds(pass1.record.latencyMs)} grid ${
      grid ? (warped?.warp ? 'warped' : `unusable (${warped?.fallback})`) : 'null'
    }`,
  );

  if (debug && grid) {
    await debug('grid.jpg', await renderGridOverlay(image, grid, warped?.warp?.quad ?? null));
  }

  if (warped?.warp && debug) {
    await debug('warped.jpg', warped.warp.image);
  }

  const runs: EvalRun[] = [];

  for (const pipeline of pipelines) {
    const prepared =
      pipeline === VisionPipelineMode.BASELINE || !warped
        ? await preparePipelineImage(VisionPipelineMode.BASELINE, image, grid)
        : { ...warped, mode: pipeline };
    const personRuns: PersonRun[] = [];

    for (const [index, name] of people.entries()) {
      personRuns.push(await runPerson({ input, table, prepared, name, index }));
    }

    const failed = personRuns.find((person) => person.call !== null && !person.call.ok);
    const failure = failed?.call
      ? {
          error: `pass2 ${failed.score.name}: ${failed.call.error}`,
          kind: failed.call.failureKind ?? VisionEvalFailureKind.INFRA,
        }
      : null;

    runs.push({
      ...base,
      pipeline,
      status: failure ? VisionEvalStatus.FAILED : VisionEvalStatus.OK,
      error: failure?.error ?? null,
      failureKind: failure?.kind ?? null,
      tableCall: pass1.record,
      table: scoreTable(truth, table),
      grid,
      warpApplied: prepared.warp !== null,
      people: personRuns,
    });
  }

  return runs;
};
