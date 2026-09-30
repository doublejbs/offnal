import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { validateDraftInput } from '@/client/DraftEditing';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type PatchDraftRequest } from '@/domain/types/api/PatchDraftRequest';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

export const CONFLICT_MESSAGE = '다른 곳에서 수정됐어요. 최신 내용을 불러온 뒤 이어서 수정해 주세요.';

const UNSAVED_MESSAGE = '저장하지 못한 수정이 있어요.';

export type LocalDraft = {
  displayName: string;
  yearMonth: string;
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
};

export type DraftSaveQueueOptions = {
  send: (body: PatchDraftRequest) => Promise<DraftResponse>;
  onSaved: (response: DraftResponse) => void;
  onStateChange: (state: DraftSaveState, message: string | null) => void;
};

export type DraftSaveQueue = {
  /** Records the latest local edit (the caller debounces `flush`). */
  markDirty: (snapshot: LocalDraft) => void;
  /** Saves pending edits after anything already queued; resolves true when nothing is left unsaved. */
  flush: () => Promise<boolean>;
  /** Saves pending edits, then sends `body` with the propagated revision (e.g. a month change). */
  patch: (body: Omit<PatchDraftRequest, 'revision'>) => Promise<DraftResponse>;
  /** Starts over from a server draft (after load, reload or a month change). */
  reset: (revision: number) => void;
  getRevision: () => number;
  isDirty: () => boolean;
  hasConflict: () => boolean;
};

/**
 * Optimistic draft autosave without React or timers. Every PATCH goes through one promise chain, so
 * revisions are always sent in order; a 409 stops all saving (never overwrites another edit) until reset.
 */
export const createDraftSaveQueue = ({
  send,
  onSaved,
  onStateChange,
}: DraftSaveQueueOptions): DraftSaveQueue => {
  let revision = 0;
  let latest: LocalDraft | null = null;
  let isDirtyFlag = false;
  let hasConflictFlag = false;
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);

    chain = run.catch(() => undefined);

    return run;
  };

  const handleFailure = (error: unknown) => {
    if (isApiClientError(error) && error.code === ApiErrorCode.REVISION_CONFLICT) {
      hasConflictFlag = true;
      onStateChange(DraftSaveState.CONFLICT, CONFLICT_MESSAGE);

      return;
    }

    onStateChange(DraftSaveState.ERROR, getErrorMessage(error));
  };

  const saveTask = async (): Promise<boolean> => {
    const snapshot = latest;

    if (!isDirtyFlag || !snapshot) {
      return true;
    }

    if (hasConflictFlag) {
      return false;
    }

    const invalid = validateDraftInput(snapshot.displayName, snapshot.definitions);

    if (invalid) {
      onStateChange(DraftSaveState.INVALID, invalid);

      return false;
    }

    isDirtyFlag = false;
    onStateChange(DraftSaveState.SAVING, null);

    try {
      const response = await send({
        revision,
        displayName: snapshot.displayName.trim(),
        entries: snapshot.entries,
        definitions: snapshot.definitions,
      });

      revision = response.draft.revision;
      onSaved(response);
      onStateChange(isDirtyFlag ? DraftSaveState.PENDING : DraftSaveState.SAVED, null);

      return !isDirtyFlag;
    } catch (error: unknown) {
      isDirtyFlag = true;
      handleFailure(error);

      return false;
    }
  };

  const flush = (): Promise<boolean> => enqueue(saveTask);

  const patch = async (body: Omit<PatchDraftRequest, 'revision'>): Promise<DraftResponse> => {
    if (!(await flush())) {
      throw new Error(UNSAVED_MESSAGE);
    }

    return enqueue(async () => {
      onStateChange(DraftSaveState.SAVING, null);

      try {
        const response = await send({ ...body, revision });

        revision = response.draft.revision;
        onStateChange(DraftSaveState.SAVED, null);

        return response;
      } catch (error: unknown) {
        handleFailure(error);
        throw error;
      }
    });
  };

  return {
    markDirty: (snapshot) => {
      latest = snapshot;
      isDirtyFlag = true;

      if (!hasConflictFlag) {
        onStateChange(DraftSaveState.PENDING, null);
      }
    },
    flush,
    patch,
    reset: (nextRevision) => {
      revision = nextRevision;
      latest = null;
      isDirtyFlag = false;
      hasConflictFlag = false;
      onStateChange(DraftSaveState.IDLE, null);
    },
    getRevision: () => revision,
    isDirty: () => isDirtyFlag,
    hasConflict: () => hasConflictFlag,
  };
};
