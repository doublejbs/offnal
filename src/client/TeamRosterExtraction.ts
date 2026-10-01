import { isApiClientError } from '@/client/ApiClient';
import { isExtractionRunning } from '@/client/TeamDisplayText';
import { type ExtractNextRequest } from '@/domain/types/api/ExtractNextRequest';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';

/** Wait when a call finished nothing (first pass or rows leased by another tab): avoids a tight request loop. */
export const IDLE_WAIT_MS = 1500;

/** Waits before each automatic retry of a transient failure (then the error reaches the screen). */
export const TRANSIENT_RETRY_DELAYS_MS = [1000, 2000, 4000];

const TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR = 500;

/** Worth retrying by itself: no network (status 0), rate limit (429) or a server error (5xx). Never other 4xx. */
export const isTransientError = (error: unknown): boolean =>
  isApiClientError(error) &&
  (error.status === 0 || error.status === TOO_MANY_REQUESTS || error.status >= FIRST_SERVER_ERROR);

export type ExtractionLoopOptions = {
  extract: (body: ExtractNextRequest) => Promise<ExtractNextResponse>;
  onProgress: (response: ExtractNextResponse) => void;
  /** Checked before every call (screen left, user stopped). */
  shouldStop: () => boolean;
  wait: (ms: number) => Promise<void>;
  /** "다시 시도": the first call also requeues FAILED rows with attempts left. */
  retryFailed?: boolean;
  /** Override for tests; default TRANSIENT_RETRY_DELAYS_MS. */
  retryDelaysMs?: number[];
};

type RetryOptions = {
  shouldStop: () => boolean;
  wait: (ms: number) => Promise<void>;
  delaysMs: number[];
};

/** One extract-next call, retried after increasing waits while the failure is transient. */
const extractWithRetry = async (
  call: () => Promise<ExtractNextResponse>,
  { shouldStop, wait, delaysMs }: RetryOptions,
): Promise<ExtractNextResponse> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error: unknown) {
      const delay = delaysMs[attempt];

      if (delay === undefined || !isTransientError(error) || shouldStop()) {
        throw error;
      }

      await wait(delay);
    }
  }
};

/**
 * Calls extract-next one at a time (each call after the previous response) while the phase is RECOGNIZING or
 * EXTRACTING. The server keeps the state, so stopping and calling again later simply resumes. Transient failures
 * are retried a few times with increasing waits; other errors (404, 4xx) and exhausted retries propagate.
 */
export const runExtractionLoop = async ({
  extract,
  onProgress,
  shouldStop,
  wait,
  retryFailed = false,
  retryDelaysMs = TRANSIENT_RETRY_DELAYS_MS,
}: ExtractionLoopOptions): Promise<ExtractNextResponse | null> => {
  let last: ExtractNextResponse | null = null;
  let isFirst = true;

  while (!shouldStop()) {
    const body = isFirst && retryFailed ? { retryFailed: true } : {};
    const response = await extractWithRetry(() => extract(body), {
      shouldStop,
      wait,
      delaysMs: retryDelaysMs,
    });

    isFirst = false;
    last = response;
    onProgress(response);

    if (!isExtractionRunning(response.progress)) {
      break;
    }

    if (response.processedRowIds.length === 0) {
      await wait(IDLE_WAIT_MS);
    }
  }

  return last;
};
