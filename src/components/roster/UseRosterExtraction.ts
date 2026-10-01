'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { extractNextRows } from '@/client/TeamApiClient';
import { runExtractionLoop } from '@/client/TeamRosterExtraction';
import { type TeamRosterFailedRow } from '@/domain/types/api/TeamRosterFailedRow';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';

type RosterExtractionInput = {
  teamId: string;
  rosterId: string;
  /** Every response's progress (the caller keeps it on its server copy). Stable. */
  onProgress: (progress: TeamRosterProgress) => void;
  /** Called once the loop ends normally (phase READY / RECOGNITION_FAILED): reload the full roster. */
  onFinished: () => void;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Drives POST extract-next one call at a time. Leaving the screen stops the loop; the server keeps every
 * row's state, so opening the roster again resumes where it stopped.
 */
export const useRosterExtraction = ({ teamId, rosterId, onProgress, onFinished }: RosterExtractionInput) => {
  const [failedRows, setFailedRows] = useState<TeamRosterFailedRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);
  const runningRef = useRef(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  useEffect(() => {
    stoppedRef.current = false;

    return () => {
      stoppedRef.current = true;
    };
  }, []);

  const start = useCallback(
    async (retryFailed = false) => {
      if (runningRef.current) {
        return;
      }

      runningRef.current = true;
      setIsRunning(true);
      setError(null);

      try {
        await runExtractionLoop({
          extract: (body) => extractNextRows(teamId, rosterId, body),
          onProgress: (response) => {
            if (!stoppedRef.current) {
              onProgress(response.progress);
              // Each response lists only rows that call finished: keep earlier failures unless re-read.
              setFailedRows((current) => [
                ...current.filter(
                  (row) =>
                    !response.processedRowIds.includes(row.rowId) &&
                    !response.failedRows.some((failed) => failed.rowId === row.rowId),
                ),
                ...response.failedRows,
              ]);
            }
          },
          shouldStop: () => stoppedRef.current,
          wait,
          retryFailed,
        });

        if (!stoppedRef.current) {
          onFinishedRef.current();
        }
      } catch (caught: unknown) {
        if (!stoppedRef.current) {
          setError(getErrorMessage(caught));
        }
      } finally {
        runningRef.current = false;

        if (!stoppedRef.current) {
          setIsRunning(false);
        }
      }
    },
    [onProgress, rosterId, teamId],
  );

  return { failedRows, isRunning, error, start };
};
