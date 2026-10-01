import { isExtractionRunning } from '@/client/TeamDisplayText';
import { type ExtractNextRequest } from '@/domain/types/api/ExtractNextRequest';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';

/** Wait when a call finished nothing (first pass or rows leased by another tab): avoids a tight request loop. */
export const IDLE_WAIT_MS = 1500;

export type ExtractionLoopOptions = {
  extract: (body: ExtractNextRequest) => Promise<ExtractNextResponse>;
  onProgress: (response: ExtractNextResponse) => void;
  /** Checked before every call (screen left, user stopped). */
  shouldStop: () => boolean;
  wait: (ms: number) => Promise<void>;
  /** "다시 시도": the first call also requeues FAILED rows with attempts left. */
  retryFailed?: boolean;
};

/**
 * Calls extract-next one at a time (each call after the previous response) while the phase is RECOGNIZING or
 * EXTRACTING. The server keeps the state, so stopping and calling again later simply resumes. Errors propagate.
 */
export const runExtractionLoop = async ({
  extract,
  onProgress,
  shouldStop,
  wait,
  retryFailed = false,
}: ExtractionLoopOptions): Promise<ExtractNextResponse | null> => {
  let last: ExtractNextResponse | null = null;
  let isFirst = true;

  while (!shouldStop()) {
    const response = await extract(isFirst && retryFailed ? { retryFailed: true } : {});

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
