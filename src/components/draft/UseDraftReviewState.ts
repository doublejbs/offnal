'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDraft, getErrorMessage, isApiClientError } from '@/client/ApiClient';
import {
  addDefinition,
  applyCodeToDate,
  type DefinitionPatch,
  removeDefinition,
  updateDefinition,
} from '@/client/DraftEditing';
import { type LocalDraft, useDraftAutosave } from '@/components/draft/UseDraftAutosave';
import { useDraftPublish } from '@/components/draft/UseDraftPublish';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { getPublishBlockers, summarizeReview } from '@/domain/ScheduleValidator';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';
import { isValidYearMonth } from '@/domain/YearMonth';

const toLocal = (response: DraftResponse): LocalDraft => ({
  displayName: response.draft.displayName,
  yearMonth: response.draft.yearMonth,
  entries: response.draft.entries,
  definitions: response.draft.definitions,
});

const pickInitialDate = (response: DraftResponse): string | null =>
  response.review.dates[0] ?? response.draft.entries[0]?.date ?? null;

const toLoadState = (error: unknown): ScreenLoadState => {
  if (isApiClientError(error) && error.code === ApiErrorCode.AUTH_REQUIRED) {
    return ScreenLoadState.AUTH_REQUIRED;
  }

  if (isApiClientError(error) && error.code === ApiErrorCode.EXPIRED) {
    return ScreenLoadState.EXPIRED;
  }

  if (isApiClientError(error) && error.status === 404) {
    return ScreenLoadState.NOT_FOUND;
  }

  return ScreenLoadState.ERROR;
};

export const useDraftReviewState = (draftId: string) => {
  const [loadState, setLoadState] = useState(ScreenLoadState.LOADING);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [server, setServer] = useState<DraftResponse | null>(null);
  const [local, setLocal] = useState<LocalDraft | null>(null);
  const [monthInput, setMonthInput] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isTimeEditorOpen, setIsTimeEditorOpen] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);
  const localRef = useRef<LocalDraft | null>(null);
  const autosave = useDraftAutosave(draftId, setServer);
  const { reset: resetAutosave, markDirty } = autosave;

  const applyLoaded = useCallback(
    (response: DraftResponse) => {
      const next = toLocal(response);

      resetAutosave(response.draft.revision);
      localRef.current = next;
      setServer(response);
      setLocal(next);
      setMonthInput(next.yearMonth);
      setSelectedDate((current) =>
        current && next.entries.some((entry) => entry.date === current) ? current : pickInitialDate(response),
      );
      setIsTimeEditorOpen(
        response.blockers.some((blocker) => blocker.reason === PublishBlockReason.MISSING_TIMES),
      );
      setLoadState(ScreenLoadState.READY);
    },
    [resetAutosave],
  );

  const handleLoadError = useCallback((error: unknown) => {
    setLoadError(getErrorMessage(error));
    setLoadState(toLoadState(error));
  }, []);

  const load = useCallback(
    () => getDraft(draftId).then(applyLoaded).catch(handleLoadError),
    [applyLoaded, draftId, handleLoadError],
  );

  useEffect(() => {
    let isActive = true;

    getDraft(draftId)
      .then((response) => isActive && applyLoaded(response))
      .catch((error: unknown) => isActive && handleLoadError(error));

    return () => {
      isActive = false;
    };
  }, [applyLoaded, draftId, handleLoadError]);

  const updateLocal = (updater: (current: LocalDraft) => LocalDraft) => {
    const current = localRef.current;

    if (!current) {
      return;
    }

    const next = updater(current);

    localRef.current = next;
    setLocal(next);
    markDirty(next);
  };

  const blockers = useMemo<PublishBlocker[]>(
    () => (local ? getPublishBlockers(local.entries, local.definitions) : []),
    [local],
  );
  const review = useMemo(() => summarizeReview(local?.entries ?? []), [local]);
  const publish = useDraftPublish({ draftId, autosave, blockers, local, server });

  const handleNameChange = (value: string) => updateLocal((current) => ({ ...current, displayName: value }));

  const handleSelectCode = (code: string | null) => {
    if (!selectedDate) {
      return;
    }

    updateLocal((current) => ({ ...current, entries: applyCodeToDate(current.entries, selectedDate, code) }));
  };

  const handleAddCode = (code: string, label: string, assignToSelected: boolean): string | null => {
    const current = localRef.current;

    if (!current) {
      return null;
    }

    const result = addDefinition(current.definitions, code, label);

    if (result.error) {
      return result.error;
    }

    const added = result.definitions.at(-1);

    updateLocal((draft) => ({
      ...draft,
      definitions: result.definitions,
      entries:
        assignToSelected && selectedDate && added
          ? applyCodeToDate(draft.entries, selectedDate, added.code)
          : draft.entries,
    }));
    setIsTimeEditorOpen(true);

    return null;
  };

  const handleUpdateDefinition = (code: string, patch: DefinitionPatch) =>
    updateLocal((current) => ({
      ...current,
      definitions: updateDefinition(current.definitions, code, patch),
    }));

  const handleRemoveDefinition = (code: string) =>
    updateLocal((current) => ({
      ...current,
      definitions: removeDefinition(current.definitions, current.entries, code) ?? current.definitions,
    }));

  const handleMonthChange = async (value: string) => {
    setMonthInput(value);
    setMonthError(null);

    const current = localRef.current;

    if (!current || !isValidYearMonth(value) || value === current.yearMonth) {
      return;
    }

    try {
      const response = await autosave.patch({ yearMonth: value });
      const next = {
        ...toLocal(response),
        displayName: localRef.current?.displayName ?? response.draft.displayName,
      };

      localRef.current = next;
      setServer(response);
      setLocal(next);
      setSelectedDate(pickInitialDate(response));
    } catch (error: unknown) {
      setMonthInput(current.yearMonth);

      if (!(isApiClientError(error) && error.code === ApiErrorCode.REVISION_CONFLICT)) {
        setMonthError(getErrorMessage(error));
      }
    }
  };

  const handleSelectBlocker = (blocker: PublishBlocker) => {
    const entries = localRef.current?.entries ?? [];

    if (blocker.reason === PublishBlockReason.UNCONFIRMED_DATES) {
      setSelectedDate(blocker.dates[0] ?? null);

      return;
    }

    const date = entries.find((entry) => entry.code !== null && blocker.codes.includes(entry.code))?.date;

    if (date) {
      setSelectedDate(date);
    }

    if (blocker.reason === PublishBlockReason.MISSING_TIMES) {
      setIsTimeEditorOpen(true);
    }
  };

  const isEditable = server?.draft.status === DraftStatus.EDITING;
  const isConflict = autosave.saveState === DraftSaveState.CONFLICT;

  return {
    loadState,
    loadError,
    server,
    local,
    monthInput,
    monthError,
    selectedDate,
    isTimeEditorOpen,
    isEditable,
    isConflict,
    blockers,
    review,
    saveState: autosave.saveState,
    saveMessage: autosave.saveMessage,
    publish,
    setSelectedDate,
    setIsTimeEditorOpen,
    handleNameChange,
    handleMonthChange,
    handleSelectCode,
    handleAddCode,
    handleUpdateDefinition,
    handleRemoveDefinition,
    handleSelectBlocker,
    handleRetrySave: autosave.flush,
    handleReload: load,
  };
};

export type DraftReviewState = ReturnType<typeof useDraftReviewState>;
