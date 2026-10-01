import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import {
  IDLE_WAIT_MS,
  isTransientError,
  runExtractionLoop,
  TRANSIENT_RETRY_DELAYS_MS,
} from '@/client/TeamRosterExtraction';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';

import { buildProgress } from './support/RosterUiFixture';

const response = (phase: TeamRosterPhase, processed: string[] = ['x']): ExtractNextResponse => ({
  progress: buildProgress({ phase }),
  processedRowIds: processed,
  failedRows: [],
});

describe('runExtractionLoop', () => {
  it('calls extract-next sequentially until the phase is no longer running', async () => {
    const replies = [
      response(TeamRosterPhase.RECOGNIZING),
      response(TeamRosterPhase.EXTRACTING),
      response(TeamRosterPhase.READY),
    ];
    const extract = vi.fn(async () => replies.shift()!);
    const onProgress = vi.fn();
    const wait = vi.fn(async () => undefined);
    const last = await runExtractionLoop({
      extract,
      onProgress,
      shouldStop: () => false,
      wait,
      retryFailed: true,
    });

    expect(extract).toHaveBeenCalledTimes(3);
    expect(extract.mock.calls[0]).toEqual([{ retryFailed: true }]);
    expect(extract.mock.calls[1]).toEqual([{}]);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(wait).not.toHaveBeenCalled();
    expect(last?.progress.phase).toBe(TeamRosterPhase.READY);
  });

  it('waits after a call that finished nothing, in any running phase', async () => {
    const replies = [response(TeamRosterPhase.RECOGNIZING, []), response(TeamRosterPhase.READY)];
    const wait = vi.fn(async () => undefined);

    await runExtractionLoop({
      extract: async () => replies.shift()!,
      onProgress: () => undefined,
      shouldStop: () => false,
      wait,
    });

    expect(wait).toHaveBeenCalledOnce();
  });

  it('waits when a call finished nothing and stops when asked', async () => {
    let stop = false;
    const extract = vi.fn(async () => response(TeamRosterPhase.EXTRACTING, []));
    const wait = vi.fn(async () => {
      stop = true;
    });

    await runExtractionLoop({ extract, onProgress: () => undefined, shouldStop: () => stop, wait });

    expect(extract).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(IDLE_WAIT_MS);
  });

  it('propagates errors so the screen can offer "다시 시도"', async () => {
    const extract = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      runExtractionLoop({
        extract,
        onProgress: () => undefined,
        shouldStop: () => false,
        wait: async () => undefined,
      }),
    ).rejects.toThrow('boom');
  });

  it('retries transient failures (network, 429, 5xx) with increasing waits, then succeeds', async () => {
    const failures = [new ApiClientError(0, null, '네트워크'), new ApiClientError(504, null, '시간 초과')];
    const extract = vi.fn(async () => {
      const failure = failures.shift();

      if (failure) {
        throw failure;
      }

      return response(TeamRosterPhase.READY);
    });
    const wait = vi.fn(async () => undefined);
    const last = await runExtractionLoop({
      extract,
      onProgress: () => undefined,
      shouldStop: () => false,
      wait,
    });

    expect(extract).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[TRANSIENT_RETRY_DELAYS_MS[0]], [TRANSIENT_RETRY_DELAYS_MS[1]]]);
    expect(last?.progress.phase).toBe(TeamRosterPhase.READY);
  });

  it('gives up after the last retry and never retries 404 or other 4xx', async () => {
    const unavailable = new ApiClientError(503, null, '점검 중');
    const alwaysDown = vi.fn(async () => {
      throw unavailable;
    });
    const wait = vi.fn(async () => undefined);

    await expect(
      runExtractionLoop({
        extract: alwaysDown,
        onProgress: () => undefined,
        shouldStop: () => false,
        wait,
        retryDelaysMs: [1, 2],
      }),
    ).rejects.toBe(unavailable);
    expect(alwaysDown).toHaveBeenCalledTimes(3);

    const missing = vi.fn(async () => {
      throw new ApiClientError(404, ApiErrorCode.NOT_FOUND, '없음');
    });

    await expect(
      runExtractionLoop({ extract: missing, onProgress: () => undefined, shouldStop: () => false, wait }),
    ).rejects.toMatchObject({ status: 404 });
    expect(missing).toHaveBeenCalledOnce();
  });

  it('classifies transient errors', () => {
    expect(isTransientError(new ApiClientError(0, null, ''))).toBe(true);
    expect(isTransientError(new ApiClientError(429, ApiErrorCode.RATE_LIMITED, ''))).toBe(true);
    expect(isTransientError(new ApiClientError(500, ApiErrorCode.INTERNAL_ERROR, ''))).toBe(true);
    expect(isTransientError(new ApiClientError(409, ApiErrorCode.ROSTER_NOT_EDITABLE, ''))).toBe(false);
    expect(isTransientError(new Error('x'))).toBe(false);
  });
});
