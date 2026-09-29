import { setTimeout as sleep } from 'node:timers/promises';

import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type EvalModelTarget } from '@/server/vision/eval/EvalArgs';
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
  getProviderErrorStatus,
  type VisionImage,
  type VisionProvider,
  VisionProviderError,
  type VisionUsage,
} from '@/server/vision/VisionProvider';

const CALL_TIMEOUT_MS = 240_000;
const MAX_RATE_LIMIT_RETRIES = 5;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 120_000;
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MODEL_UNAVAILABLE_STATUSES = new Set([400, 403, 404]);

export type CallRecord = {
  ok: boolean;
  latencyMs: number;
  retries: number;
  usage: VisionUsage | null;
  costUsd: number | null;
  error: string | null;
};

export type PersonRun = {
  score: PersonScore;
  call: CallRecord | null;
};

export type EvalRun = {
  model: string;
  sampleId: string;
  repeat: number;
  status: VisionEvalStatus;
  error: string | null;
  tableCall: CallRecord | null;
  table: TableScore | null;
  people: PersonRun[];
};

/** Thrown when the model id is not usable with this key (404 etc.): the model is skipped entirely. */
export class ModelUnavailableError extends Error {
  /** Short form for the results table, e.g. `provider_error (HTTP 404)`. */
  readonly summary: string;

  constructor(summary: string, detail: string) {
    super(`${summary}: ${detail}`);
    this.name = 'ModelUnavailableError';
    this.summary = summary;
  }
}

const describeCause = (error: unknown): string => {
  const cause = error instanceof VisionProviderError ? error.cause : error;

  return cause instanceof Error ? cause.message : String(cause);
};

const describeFailure = (error: unknown): string => {
  const status = getProviderErrorStatus(error);
  const code = error instanceof VisionProviderError ? error.errorCode : 'error';

  return status === null ? code : `${code} (HTTP ${status})`;
};

/** Server-suggested wait from a Gemini 429 body (`"retryDelay": "37s"`), in ms. */
const readRetryDelayMs = (error: unknown): number | null => {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/u.exec(describeCause(error));

  return match?.[1] ? Math.ceil(Number(match[1]) * 1000) : null;
};

/** Daily quotas do not recover within a run; retrying only burns time. */
const isDailyQuota = (error: unknown): boolean => /PerDay/u.test(describeCause(error));

type Logger = (line: string) => void;

type TimedCall<T> = { value: T | null; record: CallRecord };

/**
 * One provider call with exponential backoff on free-tier rate limits and transient 5xx.
 * After the retries the failure is recorded (never scored as success).
 */
const callWithRetry = async <T extends { usage?: VisionUsage }>(
  target: EvalModelTarget,
  run: (signal: AbortSignal) => Promise<T>,
  log: Logger,
): Promise<TimedCall<T>> => {
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
        },
      };
    } catch (error: unknown) {
      const latencyMs = Math.round(performance.now() - startedAt);
      const status = getProviderErrorStatus(error);

      if (status !== null && MODEL_UNAVAILABLE_STATUSES.has(status) && attempt === 0) {
        throw new ModelUnavailableError(describeFailure(error), describeCause(error).slice(0, 300));
      }

      const retryable = status !== null && RETRYABLE_STATUSES.has(status) && !isDailyQuota(error);

      if (!retryable || attempt >= MAX_RATE_LIMIT_RETRIES) {
        return {
          value: null,
          record: {
            ok: false,
            latencyMs,
            retries: attempt,
            usage: null,
            costUsd: null,
            error: isDailyQuota(error) ? `${describeFailure(error)} daily quota` : describeFailure(error),
          },
        };
      }

      const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
      const waitMs = Math.max(backoffMs, readRetryDelayMs(error) ?? 0);

      log(
        `[${target.label}] HTTP ${status}, retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} in ${waitMs / 1000}s`,
      );
      await sleep(waitMs);
    }
  }
};

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export type RunSampleInput = {
  target: EvalModelTarget;
  provider: VisionProvider;
  sample: EvalSample;
  image: VisionImage;
  people: string[];
  repeat: number;
  log: Logger;
};

/**
 * Same two-pass flow as the service: pass 1 once, then pass 2 per scored person with the matching
 * candidate row and the pass-1 legend, normalized with the true (user-chosen) month.
 */
export const runSample = async (input: RunSampleInput): Promise<EvalRun> => {
  const { target, provider, sample, image, people, repeat, log } = input;
  const { truth } = sample;
  const base = { model: target.label, sampleId: sample.id, repeat };
  const pass1 = await callWithRetry(target, (signal) => provider.recognizeTable(image, signal), log);
  const tableResult = pass1.value;

  if (!tableResult || !tableResult.ok) {
    const error = tableResult && !tableResult.ok ? tableResult.errorCode : pass1.record.error;

    log(`[${target.label}] ${sample.id} #${repeat} pass1 FAILED ${error}`);

    return {
      ...base,
      status: VisionEvalStatus.FAILED,
      error: `pass1: ${error}`,
      tableCall: pass1.record,
      table: scoreTable(truth, null),
      people: people.map((name) => ({ score: scorePerson(truth, name, null, null), call: null })),
    };
  }

  const table = tableResult.value;

  log(`[${target.label}] ${sample.id} #${repeat} pass1 ok ${formatSeconds(pass1.record.latencyMs)}`);

  const personRuns: PersonRun[] = [];
  let failure: string | null = null;

  for (const name of people) {
    const rowId = findCandidateRowId(table.candidates, name);

    if (rowId === null) {
      personRuns.push({ score: scorePerson(truth, name, null, null), call: null });

      continue;
    }

    const candidateName = table.candidates.find((candidate) => candidate.rowId === rowId)?.name ?? name;
    const pass2 = await callWithRetry(
      target,
      (signal) =>
        provider.extractPerson(
          image,
          { rowId, name: candidateName, yearMonth: truth.yearMonth, definitions: table.definitions },
          signal,
        ),
      log,
    );
    const schedule = pass2.value ? normalizeExtraction(pass2.value, truth.yearMonth) : null;
    const score = scorePerson(truth, name, rowId, schedule);

    if (!pass2.record.ok) {
      failure ??= `pass2 ${name}: ${pass2.record.error}`;
    }

    log(
      `[${target.label}] ${sample.id} #${repeat} pass2 ${name} ${
        pass2.record.ok ? `${score.correctDays}/${score.totalDays}` : `FAILED ${pass2.record.error}`
      } ${formatSeconds(pass2.record.latencyMs)}`,
    );
    personRuns.push({ score, call: pass2.record });
  }

  return {
    ...base,
    status: failure ? VisionEvalStatus.FAILED : VisionEvalStatus.OK,
    error: failure,
    tableCall: pass1.record,
    table: scoreTable(truth, table),
    people: personRuns,
  };
};
