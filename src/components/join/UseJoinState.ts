'use client';

import { useState } from 'react';

import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import { getInviteRows, joinTeam, lookupInvite } from '@/client/TeamApiClient';
import { describeMembershipConflict, readMembershipConflictReason } from '@/client/TeamDisplayText';
import { useLoad } from '@/components/UseLoad';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { TeamMembershipConflictReason } from '@/domain/enums/TeamMembershipConflictReason';
import { type InviteRowsResponse } from '@/domain/types/api/InviteRowsResponse';
import { type TeamMembershipSummary } from '@/domain/types/api/TeamMembershipSummary';

/** Picker value meaning "근무표에 내 이름이 없어요 / 아직 근무표가 없어요" (join without a row). */
export const NO_ROW_CHOICE = '#none';

const EMPTY_ROWS: Promise<InviteRowsResponse> = Promise.resolve({ yearMonth: null, rows: [] });

/** `/join/:token`: public lookup (team name), rows picker after login, join request. */
export const useJoinState = (token: string, isLoggedIn: boolean) => {
  const invite = useLoad(`invite-${token}`, (signal) => lookupInvite(token, signal));
  const membership = invite.data?.membership ?? null;
  const needsRows = isLoggedIn && invite.data !== null && membership === null;
  const rows = useLoad(`invite-rows-${token}-${needsRows}`, (signal) =>
    needsRows ? getInviteRows(token, signal) : EMPTY_ROWS,
  );
  const [choice, setChoice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<TeamMembershipSummary | null>(null);
  const [isGone, setIsGone] = useState(false);

  /** `picked`: a row key or NO_ROW_CHOICE (defaults to the picker's choice). */
  const handleJoin = async (picked: string | null = choice) => {
    if (picked === null || isBusy) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      setJoined(await joinTeam(token, { rowKey: picked === NO_ROW_CHOICE ? null : picked }));
    } catch (caught: unknown) {
      const reason = readMembershipConflictReason(caught);

      if (isApiClientError(caught) && caught.status === 404) {
        setIsGone(true);
      }

      // Taken by someone else, or gone after a new roster was published (VALIDATION_ERROR on rowKey).
      const isStaleRow = isApiClientError(caught) && caught.code === ApiErrorCode.VALIDATION_ERROR;

      if (reason === TeamMembershipConflictReason.ROW_TAKEN || isStaleRow) {
        setChoice(null);
        rows.reload();
      }

      if (
        reason === TeamMembershipConflictReason.ALREADY_MEMBER ||
        reason === TeamMembershipConflictReason.ALREADY_REQUESTED
      ) {
        invite.reload();
      }

      setError(reason ? describeMembershipConflict(reason) : getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  };

  return { invite, membership, rows, choice, isBusy, error, joined, isGone, setChoice, handleJoin };
};
