'use client';

import { useEffect, useState } from 'react';

import { type AutosaveTimer, createAutosaveTimer, shouldSaveOnLeave } from '@/client/AutosaveTimer';

/** What the timer needs from a save queue (DraftSaveQueue, TeamRosterSaveQueue). Must be a stable object. */
export type AutosaveTarget = {
  isDirty: () => boolean;
  flush: () => Promise<boolean>;
  /** Whether a best-effort save on leaving the screen is allowed (e.g. not after a 409). Default: yes. */
  canSaveOnLeave?: () => boolean;
};

const BROWSER_CLOCK = {
  setTimeout: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
  clearTimeout: (id: number | undefined) => window.clearTimeout(id),
};

/**
 * Shared autosave lifecycle of the editors: debounce timer, unload warning while edits are unsaved, and a
 * best-effort save when leaving the screen inside the app.
 */
export const useAutosaveTimer = (target: AutosaveTarget, delayMs: number): AutosaveTimer => {
  const [timer] = useState(() => createAutosaveTimer(() => target.flush(), delayMs, BROWSER_CLOCK));

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
      timer.cancel();

      if (shouldSaveOnLeave(target)) {
        void target.flush();
      }
    };
  }, [target, timer]);

  return timer;
};
