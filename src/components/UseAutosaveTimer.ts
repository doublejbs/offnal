'use client';

import { useEffect, useMemo, useRef } from 'react';

/** What the timer needs from a save queue (DraftSaveQueue, TeamRosterSaveQueue). Must be a stable object. */
export type AutosaveTarget = {
  isDirty: () => boolean;
  flush: () => Promise<boolean>;
  /** Whether a best-effort save on leaving the screen is allowed (e.g. not after a 409). Default: yes. */
  canSaveOnLeave?: () => boolean;
};

export type AutosaveTimer = {
  /** (Re)starts the debounce: `flush` runs `delayMs` after the last call. */
  schedule: () => void;
  /** Stops a scheduled flush (before an explicit flush / immediate PATCH / reset). */
  cancel: () => void;
};

/**
 * Shared autosave lifecycle of the editors: debounce timer, unload warning while edits are unsaved, and a
 * best-effort save when leaving the screen inside the app.
 */
export const useAutosaveTimer = (target: AutosaveTarget, delayMs: number): AutosaveTimer => {
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (target.isDirty()) {
        event.preventDefault();
        // Older browsers only show the prompt when returnValue is set.
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.clearTimeout(timerRef.current);

      if (target.isDirty() && (target.canSaveOnLeave?.() ?? true)) {
        void target.flush();
      }
    };
  }, [target]);

  return useMemo(
    () => ({
      schedule: () => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void target.flush(), delayMs);
      },
      cancel: () => window.clearTimeout(timerRef.current),
    }),
    [delayMs, target],
  );
};
