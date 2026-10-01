'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { leaveTeam } from '@/client/TeamApiClient';
import ConfirmDialog from '@/components/ConfirmDialog';

type LeaveTeamButtonProps = {
  teamId: string;
  teamName: string;
};

/** "팀 나가기" with confirmation. The last admin gets the server's LAST_ADMIN message. */
const LeaveTeamButton = ({ teamId, teamName }: LeaveTeamButtonProps) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLeave = async () => {
    setIsBusy(true);
    setError(null);

    try {
      await leaveTeam(teamId);
      router.replace('/teams');
      router.refresh();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
      setIsOpen(false);
      setIsBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      <div className="center">
        <button type="button" className="textbutton" onClick={() => setIsOpen(true)}>
          팀 나가기
        </button>
      </div>
      <ConfirmDialog
        isOpen={isOpen}
        title={`${teamName}에서 나갈까요?`}
        message="팀 근무 달이 내 달력과 공유 링크에서 바로 사라져요. 직접 저장해 둔 개인 달력은 그대로 남아요. 다시 참여하려면 초대 링크로 요청해야 해요."
        confirmLabel="나가기"
        isDanger
        isBusy={isBusy}
        onConfirm={handleLeave}
        onCancel={() => setIsOpen(false)}
      />
    </>
  );
};

export default LeaveTeamButton;
