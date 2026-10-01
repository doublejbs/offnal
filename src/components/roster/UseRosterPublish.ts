'use client';

import { useState } from 'react';

import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { publishTeamRoster } from '@/client/TeamApiClient';
import {
  isStaleBaseConflict,
  readRowBlockers,
  readUnlinkedRows,
  STALE_BASE_MESSAGE,
} from '@/client/TeamRosterErrors';
import { type RosterAutosave } from '@/components/roster/UseRosterAutosave';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type PreviousRowRef } from '@/domain/types/api/PreviousRowRef';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { type TeamRosterRowBlocker } from '@/domain/types/api/TeamRosterRowBlocker';

const UNSAVED_MESSAGE = '아직 저장되지 않은 수정이 있어요. 저장 상태를 확인한 뒤 다시 눌러 주세요.';
const BLOCKED_MESSAGE = '아직 확인이 필요한 칸이 있어요. 아래 목록을 눌러 고쳐 주세요.';
const STALE_VERSION_MESSAGE =
  '다른 곳에서 먼저 수정했어요. 최신 내용을 불러왔으니 확인한 뒤 다시 배포해 주세요.';

type RosterPublishInput = {
  teamId: string;
  rosterId: string;
  autosave: RosterAutosave;
  /** The stored roster changed elsewhere: reload it. */
  onStale: () => void;
};

/**
 * Save → publish. 422 with `unlinkedRows` opens a confirm and resends with `confirmUnlinked`; 422 blockers are
 * listed; 409 STALE_BASE means a newer revision exists (start again from it).
 */
export const useRosterPublish = ({ teamId, rosterId, autosave, onStale }: RosterPublishInput) => {
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverBlockers, setServerBlockers] = useState<TeamRosterRowBlocker[] | null>(null);
  const [unlinkedRows, setUnlinkedRows] = useState<PreviousRowRef[] | null>(null);
  const [result, setResult] = useState<PublishTeamRosterResponse | null>(null);

  const handleFailure = (caught: unknown) => {
    const unlinked = readUnlinkedRows(caught);
    const blockers = readRowBlockers(caught);

    if (unlinked) {
      setUnlinkedRows(unlinked);

      return;
    }

    if (blockers) {
      setServerBlockers(blockers);
      setError(BLOCKED_MESSAGE);

      return;
    }

    if (isStaleBaseConflict(caught)) {
      setError(STALE_BASE_MESSAGE);

      return;
    }

    if (isApiClientError(caught) && caught.code === ApiErrorCode.REVISION_CONFLICT) {
      setError(STALE_VERSION_MESSAGE);
      onStale();

      return;
    }

    setError(getErrorMessage(caught));
  };

  const handlePublish = async (confirmUnlinked = false) => {
    setIsPublishing(true);
    setError(null);
    setServerBlockers(null);

    try {
      if (!(await autosave.flush())) {
        setError(UNSAVED_MESSAGE);

        return;
      }

      const published = await publishTeamRoster(teamId, rosterId, {
        version: autosave.getVersion(),
        ...(confirmUnlinked ? { confirmUnlinked: true } : {}),
      });

      setUnlinkedRows(null);
      setResult(published);
    } catch (caught: unknown) {
      if (confirmUnlinked) {
        setUnlinkedRows(null);
      }

      handleFailure(caught);
    } finally {
      setIsPublishing(false);
    }
  };

  return {
    isPublishing,
    error,
    serverBlockers,
    unlinkedRows,
    result,
    handlePublish,
    handleCancelUnlinked: () => setUnlinkedRows(null),
  };
};

export type RosterPublishState = ReturnType<typeof useRosterPublish>;
