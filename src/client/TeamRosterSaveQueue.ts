import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import {
  EMPTY_EDITS,
  isEmptyEdits,
  mergeEdits,
  type RosterEdits,
  toPatchBody,
  validateEdits,
} from '@/client/TeamRosterEdits';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterConflictDetails } from '@/domain/types/api/TeamRosterConflictDetails';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';

export const ROSTER_CONFLICT_MESSAGE =
  '다른 곳에서 먼저 수정했어요. 최신 내용을 불러왔으니 방금 고친 칸을 다시 확인해 주세요.';

const UNSAVED_MESSAGE = '저장하지 못한 수정이 있어요. 먼저 다시 저장해 주세요.';

export type RosterSaveQueueOptions = {
  send: (body: PatchTeamRosterRequest) => Promise<TeamRosterResponse>;
  /** Every successful PATCH (the caller replaces its server copy). */
  onSaved: (response: TeamRosterResponse) => void;
  /** 409: the latest roster from `details.roster`, or null when the caller must reload it. */
  onConflict: (latest: TeamRosterResponse | null) => void;
  onStateChange: (state: DraftSaveState, message: string | null) => void;
};

export type RosterSaveQueue = {
  /** Records a local edit; the caller debounces `flush`. */
  edit: (edits: RosterEdits) => void;
  /** Saves pending edits after anything already queued; true when nothing is left unsaved. */
  flush: () => Promise<boolean>;
  /** Saves pending edits, then one immediate PATCH (row added, "이름 바뀜", month change). */
  run: (body: Omit<PatchTeamRosterRequest, 'version'>) => Promise<TeamRosterResponse>;
  /** Edits not yet confirmed by the server (in flight + pending), to draw on top of the server copy. */
  getLocalEdits: () => RosterEdits;
  /** Starts over from a server roster (load, reload, conflict). */
  reset: (version: number) => void;
  getVersion: () => number;
  isDirty: () => boolean;
};

const readConflictRoster = (error: unknown): TeamRosterResponse | null => {
  const details = isApiClientError(error)
    ? (error.details as TeamRosterConflictDetails | undefined)
    : undefined;

  return details?.roster ?? null;
};

/**
 * Roster autosave without React or timers, modelled on DraftSaveQueue: one promise chain keeps PATCHes in
 * `version` order. A 409 replaces everything with the latest roster (never overwrites another admin's edit).
 */
export const createRosterSaveQueue = ({
  send,
  onSaved,
  onConflict,
  onStateChange,
}: RosterSaveQueueOptions): RosterSaveQueue => {
  let version = 0;
  let pending: RosterEdits = EMPTY_EDITS;
  let inflight: RosterEdits = EMPTY_EDITS;
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);

    chain = run.catch(() => undefined);

    return run;
  };

  const handleFailure = (error: unknown): void => {
    if (isApiClientError(error) && error.code === ApiErrorCode.REVISION_CONFLICT) {
      const latest = readConflictRoster(error);

      pending = EMPTY_EDITS;
      inflight = EMPTY_EDITS;

      if (latest) {
        version = latest.roster.version;
      }

      onConflict(latest);
      onStateChange(DraftSaveState.CONFLICT, ROSTER_CONFLICT_MESSAGE);

      return;
    }

    if (isApiClientError(error) && error.code === ApiErrorCode.ROSTER_NOT_EDITABLE) {
      // Published elsewhere or rows still being read: retrying the same edit can never succeed. Reload instead.
      pending = EMPTY_EDITS;
      inflight = EMPTY_EDITS;
      onConflict(null);
    }

    onStateChange(DraftSaveState.ERROR, getErrorMessage(error));
  };

  const accept = (response: TeamRosterResponse): void => {
    version = response.roster.version;
    onSaved(response);
  };

  const saveTask = async (): Promise<boolean> => {
    if (isEmptyEdits(pending)) {
      return true;
    }

    const invalid = validateEdits(pending);

    if (invalid) {
      onStateChange(DraftSaveState.INVALID, invalid);

      return false;
    }

    inflight = pending;
    pending = EMPTY_EDITS;
    onStateChange(DraftSaveState.SAVING, null);

    try {
      const response = await send(toPatchBody(version, inflight));

      inflight = EMPTY_EDITS;
      accept(response);
      onStateChange(isEmptyEdits(pending) ? DraftSaveState.SAVED : DraftSaveState.PENDING, null);

      return isEmptyEdits(pending);
    } catch (error: unknown) {
      pending = mergeEdits(inflight, pending);
      inflight = EMPTY_EDITS;
      handleFailure(error);

      return false;
    }
  };

  const flush = (): Promise<boolean> => enqueue(saveTask);

  const run = async (body: Omit<PatchTeamRosterRequest, 'version'>): Promise<TeamRosterResponse> => {
    if (!(await flush())) {
      throw new Error(UNSAVED_MESSAGE);
    }

    return enqueue(async () => {
      onStateChange(DraftSaveState.SAVING, null);

      try {
        const response = await send({ ...body, version });

        accept(response);
        onStateChange(DraftSaveState.SAVED, null);

        return response;
      } catch (error: unknown) {
        handleFailure(error);
        throw error;
      }
    });
  };

  return {
    edit: (edits) => {
      pending = mergeEdits(pending, edits);
      onStateChange(DraftSaveState.PENDING, null);
    },
    flush,
    run,
    getLocalEdits: () => mergeEdits(inflight, pending),
    reset: (nextVersion) => {
      version = nextVersion;
      pending = EMPTY_EDITS;
      inflight = EMPTY_EDITS;
      onStateChange(DraftSaveState.IDLE, null);
    },
    getVersion: () => version,
    isDirty: () => !isEmptyEdits(pending) || !isEmptyEdits(inflight),
  };
};
