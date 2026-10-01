'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { createRosterDraft, listTeamRosters, revertTeamRoster } from '@/client/TeamApiClient';
import { readUnlinkedRows } from '@/client/TeamRosterErrors';
import { formatRevision } from '@/client/TeamDisplayText';
import { useLoad } from '@/components/UseLoad';
import { type PreviousRowRef } from '@/domain/types/api/PreviousRowRef';
import { type TeamRosterSummaryDto } from '@/domain/types/api/TeamRosterSummaryDto';

/** Roster list of the admin screen + "수정하기" (draft copy) and "되돌리기" (with the unlinked-rows confirm). */
export const useTeamRostersState = (teamId: string) => {
  const router = useRouter();
  const rosters = useLoad(`rosters-${teamId}`, (signal) => listTeamRosters(teamId, signal));
  const [busyRosterId, setBusyRosterId] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<TeamRosterSummaryDto | null>(null);
  const [unlinkedRows, setUnlinkedRows] = useState<PreviousRowRef[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshList = async () => {
    try {
      rosters.setData(await listTeamRosters(teamId));
    } catch {
      // Keep the current list; the error above is already shown.
    }
  };

  const handleEdit = async (roster: TeamRosterSummaryDto) => {
    setBusyRosterId(roster.id);
    setError(null);

    try {
      const { rosterId } = await createRosterDraft(teamId, roster.id);

      router.push(`/teams/${teamId}/rosters/${rosterId}`);
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
      setBusyRosterId(null);
    }
  };

  const handleRevert = async (confirmUnlinked: boolean) => {
    const target = revertTarget;

    if (!target) {
      return;
    }

    setBusyRosterId(target.id);
    setError(null);

    try {
      const result = await revertTeamRoster(
        teamId,
        target.id,
        confirmUnlinked ? { confirmUnlinked: true } : {},
      );

      setMessage(
        `${formatRevision(target.revision ?? 0)}으로 되돌려 ${formatRevision(result.revision)}을 배포했어요.`,
      );
      setRevertTarget(null);
      setUnlinkedRows(null);
      rosters.reload();
      router.refresh();
    } catch (caught: unknown) {
      const unlinked = readUnlinkedRows(caught);

      if (unlinked && !confirmUnlinked) {
        setUnlinkedRows(unlinked);
      } else {
        setError(getErrorMessage(caught));
        setRevertTarget(null);
        setUnlinkedRows(null);
        // The list is likely stale (e.g. 409: that revision was replaced meanwhile): refresh it in place.
        await refreshList();
      }
    } finally {
      setBusyRosterId(null);
    }
  };

  const handleCancelRevert = () => {
    setRevertTarget(null);
    setUnlinkedRows(null);
  };

  return {
    rosters,
    busyRosterId,
    revertTarget,
    unlinkedRows,
    message,
    error,
    setRevertTarget,
    handleEdit,
    handleRevert,
    handleCancelRevert,
  };
};
