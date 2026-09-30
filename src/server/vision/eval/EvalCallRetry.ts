import { setTimeout as sleepFor } from 'node:timers/promises';

import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { type CallRecord, type EvalCallContext } from '@/server/vision/eval/EvalTypes';
import { estimateCostUsd } from '@/server/vision/eval/ModelPrices';
import {
  getProviderErrorStatus,
  VisionProviderError,
  type VisionUsage,
} from '@/server/vision/VisionProvider';

const CALL_TIMEOUT_MS = 240_000;

export const MAX_RATE_LIMIT_RETRIES = 5;

const BASE_BACKOFF_MS = 10_000;

export const MAX_BACKOFF_MS = 120_000;

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MODEL_UNAVAILABLE_STATUSES = new Set([400, 403, 404]);

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

/** On failure `error` keeps the original provider error (errorCode, HTTP status) for the caller. */
type TimedCall<T> = { value: T | null; record: CallRecord; error: unknown };

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
        error: null,
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
          error,
          record: failedRecord(latencyMs, attempt, `${describeFailure(error)} daily quota`, kind),
        };
      }

      const retryable = status !== null && RETRYABLE_STATUSES.has(status);

      if (!retryable || attempt >= MAX_RATE_LIMIT_RETRIES) {
        return {
          value: null,
          error,
          record: failedRecord(latencyMs, attempt, describeFailure(error), kind),
        };
      }

      const serverDelayMs = readRetryDelayMs(error);

      if (serverDelayMs !== null && serverDelayMs > MAX_BACKOFF_MS) {
        return {
          value: null,
          error,
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
