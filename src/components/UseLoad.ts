'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { isAbortError, toScreenLoadState } from '@/client/LoadState';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

type LoadResult<T> = {
  key: string;
  state: ScreenLoadState;
  data: T | null;
  error: unknown;
};

export type Load<T> = {
  state: ScreenLoadState;
  data: T | null;
  error: unknown;
  errorMessage: string | null;
  reload: () => void;
  /** Local update after a mutation (keeps the screen READY). */
  setData: (data: T) => void;
};

/**
 * Loads data for a screen, keyed by `key` (a change reloads and shows LOADING again). The request is
 * aborted when the key changes or the component unmounts, so late responses never overwrite state.
 */
export const useLoad = <T>(key: string, loader: (signal: AbortSignal) => Promise<T>): Load<T> => {
  const loaderRef = useRef(loader);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadResult<T> | null>(null);
  const resultKey = `${key}#${attempt}`;

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    const controller = new AbortController();

    loaderRef
      .current(controller.signal)
      .then((data) => setResult({ key: resultKey, state: ScreenLoadState.READY, data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }

        setResult({ key: resultKey, state: toScreenLoadState(error), data: null, error });
      });

    return () => controller.abort();
  }, [resultKey]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const setData = useCallback(
    (data: T) => setResult({ key: resultKey, state: ScreenLoadState.READY, data, error: null }),
    [resultKey],
  );
  const current = result?.key === resultKey ? result : null;

  return {
    state: current?.state ?? ScreenLoadState.LOADING,
    data: current?.data ?? null,
    error: current?.error ?? null,
    errorMessage: current?.error ? getErrorMessage(current.error) : null,
    reload,
    setData,
  };
};
