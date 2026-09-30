'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDraft, getErrorMessage } from '@/client/ApiClient';
import { type LocalDraft } from '@/client/DraftSaveQueue';
import { isAbortError, toScreenLoadState } from '@/client/LoadState';
import { useDraftAutosave } from '@/components/draft/UseDraftAutosave';
import { toLocalDraft, useDraftEditing } from '@/components/draft/UseDraftEditing';
import { useDraftPublish } from '@/components/draft/UseDraftPublish';
import { listUndefinedCodes } from '@/domain/DefinedCodeResolver';
import { DraftFocusTarget } from '@/domain/enums/DraftFocusTarget';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { getPublishBlockers, summarizeReview } from '@/domain/ScheduleValidator';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';

const pickInitialDate = (response: DraftResponse): string | null =>
  response.review.dates[0] ?? response.draft.entries[0]?.date ?? null;

const hasMissingTimes = (response: DraftResponse): boolean =>
  response.blockers.some((blocker) => blocker.reason === PublishBlockReason.MISSING_TIMES);

export const useDraftReviewState = (draftId: string) => {
  const [loadState, setLoadState] = useState(ScreenLoadState.LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [server, setServer] = useState<DraftResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isTimeEditorOpen, setIsTimeEditorOpen] = useState(false);
  const [isTimeConfirmed, setIsTimeConfirmed] = useState(false);
  const localRef = useRef<LocalDraft | null>(null);
  const prevDefinitionsRef = useRef<LocalDraft['definitions'] | null>(null);
  const prevYearMonthRef = useRef<string | null>(null);
  const autosave = useDraftAutosave(draftId, setServer);
  const publish = useDraftPublish({ draftId, autosave, getLocal: () => localRef.current, server });
  const isConflict = autosave.saveState === DraftSaveState.CONFLICT;
  const handleMonthReplaced = useCallback((response: DraftResponse) => {
    setSelectedDate(pickInitialDate(response));
  }, []);
  const editing = useDraftEditing({
    autosave,
    localRef,
    setServer,
    isExternallyLocked: isConflict || publish.isPublishing,
    selectedDate,
    onMonthReplaced: handleMonthReplaced,
  });
  const { reset } = autosave;
  const { replaceLocal } = editing;

  useEffect(() => {
    const controller = new AbortController();

    getDraft(draftId, controller.signal)
      .then((response) => {
        reset(response.draft.revision);
        replaceLocal(toLocalDraft(response));
        setServer(response);
        setSelectedDate((current) =>
          current && response.draft.entries.some((entry) => entry.date === current)
            ? current
            : pickInitialDate(response),
        );
        setIsTimeEditorOpen(hasMissingTimes(response));
        setLoadState(ScreenLoadState.READY);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setLoadError(getErrorMessage(error));
          setLoadState(toScreenLoadState(error));
        }
      });

    return () => controller.abort();
  }, [attempt, draftId, replaceLocal, reset]);

  useEffect(() => {
    const currentLocal = localRef.current;

    if (!currentLocal) {
      return;
    }

    const definitionsChanged = prevDefinitionsRef.current !== currentLocal.definitions;
    const monthChanged = prevYearMonthRef.current !== currentLocal.yearMonth;

    prevDefinitionsRef.current = currentLocal.definitions;
    prevYearMonthRef.current = currentLocal.yearMonth;

    if (definitionsChanged || monthChanged) {
      setIsTimeConfirmed(false);
    }
  }, [editing]);

  const { local } = editing;
  const blockers = useMemo<PublishBlocker[]>(
    () => (local ? getPublishBlockers(local.entries, local.definitions) : []),
    [local],
  );
  const review = useMemo(() => summarizeReview(local?.entries ?? []), [local]);
  // Spec §16: codes outside the legend still waiting for a definition (time or day off).
  const undefinedCodes = useMemo(() => listUndefinedCodes(local?.entries ?? []), [local]);
  // Recognized times must be confirmed by the user (client-side check; the server checks completeness).
  const needsTimeConfirmation = server?.jobId !== null && server?.jobId !== undefined && !isTimeConfirmed;
  const canPublish = blockers.length === 0 && !needsTimeConfirmation && !editing.isLocked;

  /** Selects the first affected date / opens the time editor; the view moves focus to the returned target. */
  const handleSelectBlocker = (blocker: PublishBlocker): DraftFocusTarget => {
    if (blocker.reason === PublishBlockReason.UNCONFIRMED_DATES) {
      setSelectedDate(blocker.dates[0] ?? null);

      return DraftFocusTarget.DAY_EDITOR;
    }

    const entries = localRef.current?.entries ?? [];
    const date = entries.find((entry) => entry.code !== null && blocker.codes.includes(entry.code))?.date;

    if (date) {
      setSelectedDate(date);
    }

    if (blocker.reason === PublishBlockReason.MISSING_TIMES) {
      setIsTimeEditorOpen(true);

      return DraftFocusTarget.TIME_EDITOR;
    }

    return DraftFocusTarget.DAY_EDITOR;
  };

  /** Opens the time editor; the view focuses the row of the returned code (first undefined code). */
  const handleSelectUndefinedCodes = (): string | null => {
    setIsTimeEditorOpen(true);

    return undefinedCodes[0] ?? null;
  };

  const handleAddCode = (code: string, label: string, assignToSelected: boolean): string | null => {
    const error = editing.handleAddCode(code, label, assignToSelected);

    if (!error) {
      setIsTimeEditorOpen(true);
    }

    return error;
  };

  return {
    loadState,
    loadError,
    server,
    local,
    monthInput: editing.monthInput,
    monthError: editing.monthError,
    isMonthChanging: editing.isMonthChanging,
    selectedDate,
    isTimeEditorOpen,
    isTimeConfirmed,
    needsTimeConfirmation,
    isEditable: server?.draft.status === DraftStatus.EDITING,
    isLocked: editing.isLocked,
    canPublish,
    blockers,
    review,
    undefinedCodes,
    saveState: autosave.saveState,
    saveMessage: autosave.saveMessage,
    publish,
    setSelectedDate,
    setIsTimeEditorOpen,
    setIsTimeConfirmed,
    handleNameChange: editing.handleNameChange,
    handleMonthChange: editing.handleMonthChange,
    handleSelectCode: editing.handleSelectCode,
    handleAddCode,
    handleUpdateDefinition: editing.handleUpdateDefinition,
    handleRemoveDefinition: editing.handleRemoveDefinition,
    handleSelectBlocker,
    handleSelectUndefinedCodes,
    handleRetrySave: autosave.flush,
    handleReload: () => setAttempt((value) => value + 1),
  };
};

export type DraftReviewState = ReturnType<typeof useDraftReviewState>;
