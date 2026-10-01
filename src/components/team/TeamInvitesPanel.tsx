'use client';

import { Copy, Share2 } from 'lucide-react';

import { describeInvite } from '@/client/TeamDisplayText';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadingState from '@/components/LoadingState';
import { useTeamInvitesState } from '@/components/team/UseTeamInvitesState';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

type TeamInvitesPanelProps = {
  teamId: string;
  teamName: string;
};

/** Create an invite link (copy / share right away), list active links with expiry and uses, revoke. */
const TeamInvitesPanel = ({ teamId, teamName }: TeamInvitesPanelProps) => {
  const state = useTeamInvitesState(teamId, teamName);
  const invites = state.invites.data?.invites ?? [];
  const active = invites.filter((invite) => invite.active);
  const endedCount = invites.length - active.length;
  const inviteUrl = state.created?.url ?? null;

  return (
    <div>
      <p className="mt-0">
        링크를 받은 사람은 로그인한 뒤 근무표에서 자기 이름을 골라 참여를 요청해요. 관리자가 승인해야 근무를
        볼 수 있어서, 링크가 퍼져도 근무표는 보이지 않아요.
      </p>
      <button
        type="button"
        className={inviteUrl ? 'secondary' : 'primary'}
        disabled={state.isBusy}
        onClick={() => void state.handleCreate()}
      >
        {state.isBusy ? '만드는 중…' : '새 초대 링크 만들기'}
      </button>
      <div className="hint m-0 mt-8">14일 동안 쓸 수 있어요.</div>
      {inviteUrl && (
        <div className="stack mt-12">
          <input
            readOnly
            value={inviteUrl}
            aria-label="새 초대 링크"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="actionrow mt-0">
            {state.canShare && (
              <button type="button" className="primary" onClick={() => void state.handleShare(inviteUrl)}>
                <Share2 size={18} aria-hidden="true" />
                공유하기
              </button>
            )}
            <button
              type="button"
              className={state.canShare ? 'secondary' : 'primary'}
              onClick={() => void state.handleCopy(inviteUrl)}
            >
              <Copy size={18} aria-hidden="true" />
              링크 복사
            </button>
          </div>
        </div>
      )}
      <div className="status-line mt-8" role="status" aria-live="polite">
        {state.message}
      </div>
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <h3 className="text-14">사용 중인 링크 {active.length}개</h3>
      {state.invites.state === ScreenLoadState.LOADING && <LoadingState />}
      {state.invites.state === ScreenLoadState.ERROR && (
        <div className="warning" role="alert">
          {state.invites.errorMessage}
        </div>
      )}
      <ul className="member-list">
        {active.map((invite) => (
          <li key={invite.id} className="history-item">
            <span className="tiny min-w-0">{describeInvite(invite)}</span>
            <button
              type="button"
              className="textbutton"
              disabled={state.isBusy}
              onClick={() => state.setRevokeTarget(invite)}
            >
              중지
            </button>
          </li>
        ))}
      </ul>
      {endedCount > 0 && <div className="tiny">만료되거나 중지한 링크 {endedCount}개</div>}
      <ConfirmDialog
        isOpen={state.revokeTarget !== null}
        title="초대 링크를 중지할까요?"
        message="이 링크로는 더 이상 참여 요청을 보낼 수 없어요. 이미 참여한 팀원과 기다리는 요청은 그대로예요."
        confirmLabel="링크 중지"
        isDanger
        isBusy={state.isBusy}
        onConfirm={() => void state.handleRevoke()}
        onCancel={() => state.setRevokeTarget(null)}
      />
    </div>
  );
};

export default TeamInvitesPanel;
