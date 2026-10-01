'use client';

import { useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import {
  approveTeamMember,
  listTeamMembers,
  rejectTeamMember,
  removeTeamMember,
  updateTeamMember,
} from '@/client/TeamApiClient';
import { useLoad } from '@/components/UseLoad';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { type TeamRole } from '@/domain/enums/TeamRole';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';

/** Members panel: approve (optionally with another row) / reject, relink, promote/demote, remove. */
export const useTeamMembersState = (teamId: string, onPendingCountChange: (count: number) => void) => {
  const members = useLoad(`members-${teamId}`, (signal) => listTeamMembers(teamId, signal));
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Runs one action, then refreshes the list in place (no loading flash) and the pending count. */
  const run = async (userId: string, task: () => Promise<unknown>, successMessage: string) => {
    setBusyUserId(userId);
    setError(null);
    setMessage(null);

    try {
      await task();
      setMessage(successMessage);
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
    }

    try {
      const fresh = await listTeamMembers(teamId);

      members.setData(fresh);
      onPendingCountChange(
        fresh.members.filter((member) => member.status === TeamMemberStatus.PENDING).length,
      );
    } catch {
      // The action result is already shown; the list refreshes on the next open.
    } finally {
      setBusyUserId(null);
    }
  };

  /** `rowKey` undefined = approve the requested row. */
  const handleApprove = (member: TeamMemberDto, rowKey: string | null | undefined) =>
    run(
      member.userId,
      () => approveTeamMember(teamId, member.userId, rowKey === undefined ? {} : { rowKey }),
      `${member.displayName}님을 승인했어요. 이제 팀 근무가 달력에 나타나요.`,
    );

  const handleReject = (member: TeamMemberDto) =>
    run(
      member.userId,
      () => rejectTeamMember(teamId, member.userId),
      `${member.displayName}님의 요청을 거절했어요.`,
    );

  const handleChangeRow = (member: TeamMemberDto, rowKey: string | null) =>
    run(
      member.userId,
      () => updateTeamMember(teamId, member.userId, { rowKey }),
      `${member.displayName}님의 근무표 행을 바꿨어요.`,
    );

  const handleChangeRole = (member: TeamMemberDto, role: TeamRole) =>
    run(
      member.userId,
      () => updateTeamMember(teamId, member.userId, { role }),
      `${member.displayName}님의 역할을 바꿨어요.`,
    );

  const handleRemove = async () => {
    const target = removeTarget;

    if (!target) {
      return;
    }

    await run(
      target.userId,
      () => removeTeamMember(teamId, target.userId),
      `${target.displayName}님을 팀에서 내보냈어요.`,
    );
    setRemoveTarget(null);
  };

  return {
    members,
    busyUserId,
    removeTarget,
    message,
    error,
    setRemoveTarget,
    handleApprove,
    handleReject,
    handleChangeRow,
    handleChangeRole,
    handleRemove,
  };
};
