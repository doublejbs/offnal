'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage, isApiClientError, patchDraft } from '@/client/ApiClient';
import { validateDraftInput } from '@/client/DraftEditing';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PatchDraftRequest } from '@/domain/types/api/PatchDraftRequest';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const AUTOSAVE_DELAY_MS = 600;
const CONFLICT_MESSAGE = '다른 곳에서 수정됐어요. 최신 내용을 불러온 뒤 이어서 수정해 주세요.';

export type LocalDraft = {
  displayName: string;
  yearMonth: string;
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
};

export type DraftAutosave = {
  saveState: DraftSaveState;
  saveMessage: string | null;
  /** Records the latest local edit and (re)starts the debounce timer. */
  markDirty: (snapshot: LocalDraft) => void;
  /** Saves pending edits now; resolves true when nothing is left unsaved. */
  flush: () => Promise<boolean>;
  /** Sends an extra PATCH (e.g. month change) after pending saves, with the current revision. */
  patch: (body: Omit<PatchDraftRequest, 'revision'>) => Promise<DraftResponse>;
  /** Starts over from a freshly loaded server draft. */
  reset: (revision: number) => void;
  /** Revision of the last successful save (what publish must send). */
  getRevision: () => number;
};

/**
 * Debounced optimistic autosave. All PATCHes run through one promise queue so revisions stay in
 * order; a 409 stops autosaving until the caller reloads (never overwrites another edit).
 */
export const useDraftAutosave = (
  draftId: string,
  onSaved: (response: DraftResponse) => void,
): DraftAutosave => {
  const [saveState, setSaveState] = useState(DraftSaveState.IDLE);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const revisionRef = useRef(0);
  const latestRef = useRef<LocalDraft | null>(null);
  const isDirtyRef = useRef(false);
  const hasConflictRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task, task);

    queueRef.current = run.catch(() => undefined);

    return run;
  }, []);

  const handleFailure = useCallback((error: unknown) => {
    if (isApiClientError(error) && error.code === ApiErrorCode.REVISION_CONFLICT) {
      hasConflictRef.current = true;
      setSaveState(DraftSaveState.CONFLICT);
      setSaveMessage(CONFLICT_MESSAGE);

      return;
    }

    setSaveState(DraftSaveState.ERROR);
    setSaveMessage(getErrorMessage(error));
  }, []);

  const saveTask = useCallback(async (): Promise<boolean> => {
    const snapshot = latestRef.current;

    if (!isDirtyRef.current || !snapshot) {
      return true;
    }

    if (hasConflictRef.current) {
      return false;
    }

    const invalid = validateDraftInput(snapshot.displayName, snapshot.definitions);

    if (invalid) {
      setSaveState(DraftSaveState.INVALID);
      setSaveMessage(invalid);

      return false;
    }

    isDirtyRef.current = false;
    setSaveState(DraftSaveState.SAVING);

    try {
      const response = await patchDraft(draftId, {
        revision: revisionRef.current,
        displayName: snapshot.displayName.trim(),
        entries: snapshot.entries,
        definitions: snapshot.definitions,
      });

      revisionRef.current = response.draft.revision;
      onSavedRef.current(response);
      setSaveState(isDirtyRef.current ? DraftSaveState.PENDING : DraftSaveState.SAVED);
      setSaveMessage(null);

      return !isDirtyRef.current;
    } catch (error: unknown) {
      isDirtyRef.current = true;
      handleFailure(error);

      return false;
    }
  }, [draftId, handleFailure]);

  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timerRef.current);

    return enqueue(saveTask);
  }, [enqueue, saveTask]);

  const markDirty = useCallback(
    (snapshot: LocalDraft) => {
      latestRef.current = snapshot;
      isDirtyRef.current = true;

      if (hasConflictRef.current) {
        return;
      }

      setSaveState(DraftSaveState.PENDING);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void enqueue(saveTask);
      }, AUTOSAVE_DELAY_MS);
    },
    [enqueue, saveTask],
  );

  const patch = useCallback(
    async (body: Omit<PatchDraftRequest, 'revision'>): Promise<DraftResponse> => {
      await flush();

      return enqueue(async () => {
        try {
          setSaveState(DraftSaveState.SAVING);

          const response = await patchDraft(draftId, { ...body, revision: revisionRef.current });

          revisionRef.current = response.draft.revision;
          setSaveState(DraftSaveState.SAVED);
          setSaveMessage(null);

          return response;
        } catch (error: unknown) {
          handleFailure(error);
          throw error;
        }
      });
    },
    [draftId, enqueue, flush, handleFailure],
  );

  const reset = useCallback((revision: number) => {
    window.clearTimeout(timerRef.current);
    revisionRef.current = revision;
    isDirtyRef.current = false;
    hasConflictRef.current = false;
    latestRef.current = null;
    setSaveState(DraftSaveState.IDLE);
    setSaveMessage(null);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        event.preventDefault();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.clearTimeout(timerRef.current);

      // Leaving inside the app: send what is pending (best effort).
      if (isDirtyRef.current && !hasConflictRef.current) {
        void enqueue(saveTask);
      }
    };
  }, [enqueue, saveTask]);

  const getRevision = useCallback(() => revisionRef.current, []);

  return { saveState, saveMessage, markDirty, flush, patch, reset, getRevision };
};
