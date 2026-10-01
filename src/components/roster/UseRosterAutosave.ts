'use client';

import { useMemo, useState } from 'react';

import { patchTeamRoster } from '@/client/TeamApiClient';
import { EMPTY_EDITS, type RosterEdits } from '@/client/TeamRosterEdits';
import { createRosterSaveQueue, type RosterSaveQueue } from '@/client/TeamRosterSaveQueue';
import { useAutosaveTimer } from '@/components/UseAutosaveTimer';
import { DraftSaveState } from '@/domain/enums/DraftSaveState';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';

const AUTOSAVE_DELAY_MS = 600;

type RosterAutosaveInput = {
  teamId: string;
  rosterId: string;
  /** Stable callbacks (state setters / memoized). */
  onSaved: (response: TeamRosterResponse) => void;
  onConflict: (latest: TeamRosterResponse | null) => void;
};

export type RosterAutosave = Omit<RosterSaveQueue, 'getLocalEdits'> & {
  saveState: DraftSaveState;
  saveMessage: string | null;
  /** Unsaved edits (in flight + pending) as React state, to draw on top of the server copy. */
  localEdits: RosterEdits;
};

/** React wrapper of the roster save queue: 600ms debounce, unload warning, best-effort save on unmount. */
export const useRosterAutosave = ({
  teamId,
  rosterId,
  onSaved,
  onConflict,
}: RosterAutosaveInput): RosterAutosave => {
  const [saveState, setSaveState] = useState(DraftSaveState.IDLE);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<RosterEdits>(EMPTY_EDITS);
  const [queue] = useState(() => {
    // The state callback reads the queue it belongs to (assigned right below, before any edit).
    let created: RosterSaveQueue | null = null;

    created = createRosterSaveQueue({
      send: (body) => patchTeamRoster(teamId, rosterId, body),
      onSaved,
      onConflict,
      onStateChange: (state, message) => {
        setSaveState(state);
        setSaveMessage(message);
        setLocalEdits(created?.getLocalEdits() ?? EMPTY_EDITS);
      },
    });

    return created;
  });

  const timer = useAutosaveTimer(queue, AUTOSAVE_DELAY_MS);

  const actions = useMemo(
    () => ({
      edit: (edits: RosterEdits) => {
        queue.edit(edits);
        setLocalEdits(queue.getLocalEdits());
        timer.schedule();
      },
      flush: () => {
        timer.cancel();

        return queue.flush();
      },
      run: (body: Parameters<RosterSaveQueue['run']>[0]) => {
        timer.cancel();

        return queue.run(body);
      },
      reset: (version: number) => {
        timer.cancel();
        queue.reset(version);
      },
      getVersion: queue.getVersion,
      isDirty: queue.isDirty,
    }),
    [queue, timer],
  );

  return { ...actions, saveState, saveMessage, localEdits };
};
