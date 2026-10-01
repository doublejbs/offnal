'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { isAbortError, toScreenLoadState } from '@/client/LoadState';
import { getTeamRoster } from '@/client/TeamApiClient';
import { isExtractionRunning } from '@/client/TeamDisplayText';
import { applyEdits } from '@/client/TeamRosterEdits';
import { useRosterAutosave } from '@/components/roster/UseRosterAutosave';
import { useRosterEdits } from '@/components/roster/UseRosterEdits';
import { useRosterExtraction } from '@/components/roster/UseRosterExtraction';
import { useRosterPublish } from '@/components/roster/UseRosterPublish';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type TeamRosterProgress } from '@/domain/types/api/TeamRosterProgress';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';

/** The admin roster screen: load, extraction loop, autosaved edits and publish, around one server copy. */
export const useRosterEditorState = (teamId: string, rosterId: string) => {
  const [loadState, setLoadState] = useState(ScreenLoadState.LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Attempt whose GET has settled: while it lags `attempt` a reload is in flight and editing is locked.
  const [settledAttempt, setSettledAttempt] = useState(0);
  const [server, setServer] = useState<TeamRosterResponse | null>(null);
  // Extraction just finished: progress already says READY but rows/version are stale until the reload lands.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleReload = useCallback(() => setAttempt((value) => value + 1), []);
  const handleFinished = useCallback(() => {
    setIsRefreshing(true);
    handleReload();
  }, [handleReload]);
  const handleConflict = useCallback(
    (latest: TeamRosterResponse | null) => {
      if (latest) {
        setServer(latest);
      } else {
        handleReload();
      }
    },
    [handleReload],
  );
  const autosave = useRosterAutosave({ teamId, rosterId, onSaved: setServer, onConflict: handleConflict });
  const handleProgress = useCallback(
    (progress: TeamRosterProgress) => setServer((current) => (current ? { ...current, progress } : current)),
    [],
  );
  const extraction = useRosterExtraction({
    teamId,
    rosterId,
    onProgress: handleProgress,
    onFinished: handleFinished,
  });
  const { reset } = autosave;
  const { start } = extraction;

  useEffect(() => {
    const controller = new AbortController();

    getTeamRoster(teamId, rosterId, controller.signal)
      .then((response) => {
        reset(response.roster.version);
        setServer(response);
        setIsRefreshing(false);
        setSettledAttempt(attempt);
        setLoadState(ScreenLoadState.READY);

        if (response.roster.status === TeamRosterStatus.DRAFT && isExtractionRunning(response.progress)) {
          void start();
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setIsRefreshing(false);
          setSettledAttempt(attempt);
          setLoadError(getErrorMessage(error));
          setLoadState(toScreenLoadState(error));
        }
      });

    return () => controller.abort();
  }, [attempt, reset, rosterId, start, teamId]);

  const view = useMemo(
    () => (server ? applyEdits(server, autosave.localEdits) : null),
    [server, autosave.localEdits],
  );
  const publish = useRosterPublish({ teamId, rosterId, autosave, onStale: handleReload });
  const isReloading = attempt !== settledAttempt;
  const isLocked = publish.isPublishing || extraction.isRunning || isReloading;
  const edits = useRosterEdits({ view, autosave, isLocked });

  return {
    loadState,
    loadError,
    isRefreshing,
    server,
    view,
    extraction,
    autosave,
    edits,
    publish,
    isLocked,
    handleReload,
  };
};

export type RosterEditorState = ReturnType<typeof useRosterEditorState>;
