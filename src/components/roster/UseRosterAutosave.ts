'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { patchTeamRoster } from '@/client/TeamApiClient';
import { EMPTY_EDITS, type RosterEdits } from '@/client/TeamRosterEdits';
import { createRosterSaveQueue, type RosterSaveQueue } from '@/client/TeamRosterSaveQueue';
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
  const timerRef = useRef<number | undefined>(undefined);
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

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.isDirty()) {
        event.preventDefault();
        // Older browsers only show the prompt when returnValue is set.
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.clearTimeout(timerRef.current);

      if (queue.isDirty()) {
        void queue.flush();
      }
    };
  }, [queue]);

  const actions = useMemo(
    () => ({
      edit: (edits: RosterEdits) => {
        queue.edit(edits);
        setLocalEdits(queue.getLocalEdits());
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void queue.flush(), AUTOSAVE_DELAY_MS);
      },
      flush: () => {
        window.clearTimeout(timerRef.current);

        return queue.flush();
      },
      run: (body: Parameters<RosterSaveQueue['run']>[0]) => {
        window.clearTimeout(timerRef.current);

        return queue.run(body);
      },
      reset: (version: number) => {
        window.clearTimeout(timerRef.current);
        queue.reset(version);
      },
      getVersion: queue.getVersion,
      isDirty: queue.isDirty,
    }),
    [queue],
  );

  return { ...actions, saveState, saveMessage, localEdits };
};
