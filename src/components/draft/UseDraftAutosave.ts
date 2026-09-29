'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { patchDraft } from '@/client/ApiClient';
import { createDraftSaveQueue, type DraftSaveQueue, type LocalDraft } from '@/client/DraftSaveQueue';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';

const AUTOSAVE_DELAY_MS = 600;

export type DraftAutosave = DraftSaveQueue & {
  saveState: DraftSaveState;
  saveMessage: string | null;
};

/**
 * React wrapper of DraftSaveQueue: 600ms debounce, unload warning, best-effort save on unmount.
 * `onSaved` must be stable (e.g. a state setter); the returned functions are stable as well.
 */
export const useDraftAutosave = (
  draftId: string,
  onSaved: (response: DraftResponse) => void,
): DraftAutosave => {
  const [saveState, setSaveState] = useState(DraftSaveState.IDLE);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [queue] = useState(() =>
    createDraftSaveQueue({
      send: (body) => patchDraft(draftId, body),
      onSaved,
      onStateChange: (state, message) => {
        setSaveState(state);
        setSaveMessage(message);
      },
    }),
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.isDirty()) {
        event.preventDefault();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.clearTimeout(timerRef.current);

      // Leaving inside the app: send what is pending (best effort).
      if (queue.isDirty() && !queue.hasConflict()) {
        void queue.flush();
      }
    };
  }, [queue]);

  const actions = useMemo<DraftSaveQueue>(
    () => ({
      ...queue,
      markDirty: (snapshot: LocalDraft) => {
        queue.markDirty(snapshot);
        window.clearTimeout(timerRef.current);

        if (!queue.hasConflict()) {
          timerRef.current = window.setTimeout(() => void queue.flush(), AUTOSAVE_DELAY_MS);
        }
      },
      flush: () => {
        window.clearTimeout(timerRef.current);

        return queue.flush();
      },
      patch: (body) => {
        window.clearTimeout(timerRef.current);

        return queue.patch(body);
      },
      reset: (revision: number) => {
        window.clearTimeout(timerRef.current);
        queue.reset(revision);
      },
    }),
    [queue],
  );

  return { ...actions, saveState, saveMessage };
};
