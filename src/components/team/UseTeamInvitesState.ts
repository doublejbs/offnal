'use client';

import { useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { SHARE_LINK_OUTCOME_MESSAGES } from '@/client/ShareOutcomeMessages';
import { getBrowserShareEnvironment, shareOrCopyLink } from '@/client/ShareOrDownload';
import { createTeamInvite, listTeamInvites, revokeTeamInvite } from '@/client/TeamApiClient';
import { useLoad } from '@/components/UseLoad';
import { type CreateTeamInviteResponse } from '@/domain/types/api/CreateTeamInviteResponse';
import { type TeamInviteDto } from '@/domain/types/api/TeamInviteDto';

/** Invite links: the token/URL exists only in the create response, so the new link stays on screen. */
export const useTeamInvitesState = (teamId: string, teamName: string) => {
  const invites = useLoad(`invites-${teamId}`, (signal) => listTeamInvites(teamId, signal));
  const [created, setCreated] = useState<CreateTeamInviteResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<TeamInviteDto | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canShare = Boolean(getBrowserShareEnvironment().share);

  const refresh = async () => {
    try {
      invites.setData(await listTeamInvites(teamId));
    } catch {
      // The list refreshes on the next open.
    }
  };

  const handleCreate = async () => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      setCreated(await createTeamInvite(teamId));
      setMessage(
        '초대 링크를 만들었어요. 지금 복사하거나 공유해 주세요. 이 화면을 나가면 다시 볼 수 없어요.',
      );
      await refresh();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
    }
  };

  /** Called straight from the click so navigator.share keeps the user gesture. */
  const handleShare = async (url: string) => {
    const environment = getBrowserShareEnvironment();
    const { share } = environment;
    const outcome = await shareOrCopyLink(url, {
      ...environment,
      share: share
        ? () =>
            share({
              title: `${teamName} 초대`,
              text: `${teamName} 근무표를 오프날에서 함께 봐요.`,
              url,
            })
        : undefined,
    });

    setMessage(SHARE_LINK_OUTCOME_MESSAGES[outcome]);
  };

  const handleCopy = async (url: string) => {
    setMessage(
      SHARE_LINK_OUTCOME_MESSAGES[
        await shareOrCopyLink(url, { ...getBrowserShareEnvironment(), share: undefined })
      ],
    );
  };

  const handleRevoke = async () => {
    const target = revokeTarget;

    if (!target) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await revokeTeamInvite(teamId, target.id);

      if (created?.invite.id === target.id) {
        setCreated(null);
      }

      setMessage('초대 링크를 중지했어요. 이 링크로는 더 이상 참여할 수 없어요.');
      await refresh();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
    } finally {
      setIsBusy(false);
      setRevokeTarget(null);
    }
  };

  return {
    invites,
    created,
    revokeTarget,
    isBusy,
    message,
    error,
    canShare,
    setRevokeTarget,
    handleCreate,
    handleShare,
    handleCopy,
    handleRevoke,
  };
};
