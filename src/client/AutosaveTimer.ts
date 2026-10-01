/** Timer functions (window.setTimeout / clearTimeout in the app, fakes in tests). */
export type TimerClock = {
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number | undefined) => void;
};

export type AutosaveTimer = {
  /** (Re)starts the debounce: `flush` runs `delayMs` after the last call. */
  schedule: () => void;
  /** Stops a scheduled flush (before an explicit flush / immediate PATCH / reset / leaving). */
  cancel: () => void;
};

/** Debounce of the autosave queues, without React. Pure apart from the injected clock. */
export const createAutosaveTimer = (
  flush: () => unknown,
  delayMs: number,
  clock: TimerClock,
): AutosaveTimer => {
  let timer: number | undefined;

  return {
    schedule: () => {
      clock.clearTimeout(timer);
      timer = clock.setTimeout(() => {
        timer = undefined;
        void flush();
      }, delayMs);
    },
    cancel: () => {
      clock.clearTimeout(timer);
      timer = undefined;
    },
  };
};

/** Best-effort save when leaving the screen: only with unsaved edits and when the queue allows it (no 409). */
export const shouldSaveOnLeave = (target: {
  isDirty: () => boolean;
  canSaveOnLeave?: () => boolean;
}): boolean => target.isDirty() && (target.canSaveOnLeave?.() ?? true);
