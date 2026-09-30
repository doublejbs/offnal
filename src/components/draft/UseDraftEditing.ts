'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import {
  addDefinition,
  applyCodeToDate,
  type DefinitionPatch,
  removeDefinition,
  updateDefinitionAndResolve,
} from '@/client/DraftEditing';
import { type LocalDraft } from '@/client/DraftSaveQueue';
import { type DraftAutosave } from '@/components/draft/UseDraftAutosave';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { isValidYearMonth } from '@/domain/YearMonth';

export const toLocalDraft = (response: DraftResponse): LocalDraft => ({
  displayName: response.draft.displayName,
  yearMonth: response.draft.yearMonth,
  entries: response.draft.entries,
  definitions: response.draft.definitions,
});

type DraftEditingInput = {
  autosave: DraftAutosave;
  /** Owned by the caller so other hooks can read the latest local draft at event time. */
  localRef: RefObject<LocalDraft | null>;
  setServer: (response: DraftResponse) => void;
  /** Publishing or a stopped (409) autosave: every edit is ignored. */
  isExternallyLocked: boolean;
  selectedDate: string | null;
  onMonthReplaced: (response: DraftResponse) => void;
};

/** Local draft state + every edit handler. Edits always go through `markDirty` (never lost). */
export const useDraftEditing = ({
  autosave,
  localRef,
  setServer,
  isExternallyLocked,
  selectedDate,
  onMonthReplaced,
}: DraftEditingInput) => {
  const [local, setLocal] = useState<LocalDraft | null>(null);
  const [monthInput, setMonthInput] = useState('');
  const [monthError, setMonthError] = useState<string | null>(null);
  const [isMonthChanging, setIsMonthChanging] = useState(false);
  const isLockedRef = useRef(false);
  const isLocked = isExternallyLocked || isMonthChanging;
  const { markDirty, patch, reset } = autosave;

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  const replaceLocal = useCallback(
    (next: LocalDraft) => {
      localRef.current = next;
      setLocal(next);
      setMonthInput(next.yearMonth);
    },
    [localRef],
  );

  const updateLocal = (updater: (current: LocalDraft) => LocalDraft) => {
    const current = localRef.current;

    if (!current || isLockedRef.current) {
      return;
    }

    const next = updater(current);

    localRef.current = next;
    setLocal(next);
    markDirty(next);
  };

  const handleNameChange = (value: string) => updateLocal((current) => ({ ...current, displayName: value }));

  const handleSelectCode = (code: string | null) => {
    if (selectedDate) {
      updateLocal((current) => ({
        ...current,
        entries: applyCodeToDate(current.entries, selectedDate, code),
      }));
    }
  };

  /** Returns an error message, or null when the code was added. */
  const handleAddCode = (code: string, label: string, assignToSelected: boolean): string | null => {
    const current = localRef.current;

    if (!current || isLockedRef.current) {
      return null;
    }

    const result = addDefinition(current.definitions, code, label);
    const added = result.definitions.at(-1);

    if (result.error) {
      return result.error;
    }

    updateLocal((draft) => ({
      ...draft,
      definitions: result.definitions,
      entries:
        assignToSelected && selectedDate && added
          ? applyCodeToDate(draft.entries, selectedDate, added.code)
          : draft.entries,
    }));

    return null;
  };

  const handleUpdateDefinition = (code: string, definitionPatch: DefinitionPatch) =>
    updateLocal((current) => ({ ...current, ...updateDefinitionAndResolve(current, code, definitionPatch) }));

  const handleRemoveDefinition = (code: string) =>
    updateLocal((current) => ({
      ...current,
      definitions: removeDefinition(current.definitions, current.entries, code) ?? current.definitions,
    }));

  /**
   * Month change = pending edits saved, then one PATCH the server re-maps by day number. Editing is
   * locked meanwhile and the autosave state restarts from the response revision.
   */
  const handleMonthChange = async (value: string) => {
    const current = localRef.current;

    setMonthInput(value);
    setMonthError(null);

    if (!current || isLockedRef.current || !isValidYearMonth(value) || value === current.yearMonth) {
      return;
    }

    isLockedRef.current = true;
    setIsMonthChanging(true);

    try {
      const response = await patch({ yearMonth: value, displayName: current.displayName.trim() });

      reset(response.draft.revision);
      replaceLocal(toLocalDraft(response));
      setServer(response);
      onMonthReplaced(response);
    } catch (error: unknown) {
      setMonthInput(current.yearMonth);

      if (!(isApiClientError(error) && error.code === ApiErrorCode.REVISION_CONFLICT)) {
        setMonthError(getErrorMessage(error));
      }
    } finally {
      setIsMonthChanging(false);
    }
  };

  return {
    local,
    monthInput,
    monthError,
    isMonthChanging,
    isLocked,
    replaceLocal,
    handleNameChange,
    handleSelectCode,
    handleAddCode,
    handleUpdateDefinition,
    handleRemoveDefinition,
    handleMonthChange,
  };
};
