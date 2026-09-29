/** Autosave status of the draft review screen. */
export enum DraftSaveState {
  IDLE = 'idle',
  PENDING = 'pending',
  SAVING = 'saving',
  SAVED = 'saved',
  INVALID = 'invalid',
  CONFLICT = 'conflict',
  ERROR = 'error',
}
