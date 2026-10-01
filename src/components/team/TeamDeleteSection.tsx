'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { deleteTeam } from '@/client/TeamApiClient';
import TypedConfirmDialog from '@/components/team/TypedConfirmDialog';

type TeamDeleteSectionProps = {
  teamId: string;
  teamName: string;
};

/** Danger zone: deleting removes every roster, invite and membership (accounts stay). */
const TeamDeleteSection = ({ teamId, teamName }: TeamDeleteSectionProps) => {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsBusy(true);
    setError(null);

    try {
      await deleteTeam(teamId);
      router.replace('/teams');
      router.refresh();
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
      setIsBusy(false);
      setIsOpen(false);
    }
  };

  return (
    <section className="danger-zone" aria-label="팀 삭제">
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="danger" onClick={() => setIsOpen(true)}>
        팀 삭제
      </button>
      <TypedConfirmDialog
        isOpen={isOpen}
        title="팀을 삭제할까요?"
        message="모든 근무표·초대 링크·팀원 연결이 지워지고 되돌릴 수 없어요. 팀원 달력과 공유 링크에서도 팀 근무 달이 바로 사라져요. 각자 저장한 개인 달력은 남아요."
        expectedText={teamName}
        inputLabel={`확인을 위해 팀 이름 “${teamName}”을 입력해 주세요`}
        confirmLabel="영구 삭제"
        isBusy={isBusy}
        onConfirm={handleDelete}
        onCancel={() => setIsOpen(false)}
      />
    </section>
  );
};

export default TeamDeleteSection;
