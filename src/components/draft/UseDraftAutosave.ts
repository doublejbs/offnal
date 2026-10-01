'use client';

import { useMemo, useState } from 'react';

import { patchDraft } from '@/client/ApiClient';
import { createDraftSaveQueue, type DraftSaveQueue, type LocalDraft } from '@/client/DraftSaveQueue';
import { useAutosaveTimer } from '@/components/UseAutosaveTimer';
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

  // Leaving inside the app sends what is pending (best effort), except after a 409.
  const [target] = useState(() => ({ ...queue, canSaveOnLeave: () => !queue.hasConflict() }));
  const timer = useAutosaveTimer(target, AUTOSAVE_DELAY_MS);

  const actions = useMemo<DraftSaveQueue>(
    () => ({
      ...queue,
      markDirty: (snapshot: LocalDraft) => {
        queue.markDirty(snapshot);
        timer.cancel();

        if (!queue.hasConflict()) {
          timer.schedule();
        }
      },
      flush: () => {
        timer.cancel();

        return queue.flush();
      },
      patch: (body) => {
        timer.cancel();

        return queue.patch(body);
      },
      reset: (revision: number) => {
        timer.cancel();
        queue.reset(revision);
      },
    }),
    [queue, timer],
  );

  return { ...actions, saveState, saveMessage };
};
