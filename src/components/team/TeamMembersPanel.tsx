'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import LoadingState from '@/components/LoadingState';
import MemberItemView from '@/components/team/MemberItemView';
import { useTeamMembersState } from '@/components/team/UseTeamMembersState';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type TeamMembersPanelProps = {
  teamId: string;
  onPendingCountChange: (count: number) => void;
};

/** Join requests (oldest first) and active members with the latest roster's free rows to link. */
const TeamMembersPanel = ({ teamId, onPendingCountChange }: TeamMembersPanelProps) => {
  const state = useTeamMembersState(teamId, onPendingCountChange);
  const data = state.members.data;

  if (state.members.state === ScreenLoadState.LOADING) {
    return <LoadingState text="팀원을 불러오는 중이에요…" />;
  }

  if (!data) {
    return (
      <div className="warning" role="alert">
        {state.members.errorMessage ?? '팀원을 불러오지 못했어요.'}
        <button type="button" className="secondary mt-10" onClick={state.members.reload}>
          다시 불러오기
        </button>
      </div>
    );
  }

  const pending = data.members.filter((member) => member.status === TeamMemberStatus.PENDING);
  const active = data.members.filter((member) => member.status === TeamMemberStatus.ACTIVE);
  const hasRoster = data.rosterYearMonth !== null;

  const renderMember = (member: (typeof data.members)[number]) => (
    <MemberItemView
      key={`${member.userId}-${member.status}-${member.linkedRowKey ?? ''}`}
      member={member}
      availableRows={data.availableRows}
      hasRoster={hasRoster}
      isBusy={state.busyUserId === member.userId}
      onApprove={(target, rowKey) => void state.handleApprove(target, rowKey)}
      onReject={(target) => void state.handleReject(target)}
      onChangeRow={(target, rowKey) => void state.handleChangeRow(target, rowKey)}
      onChangeRole={(target, role) => void state.handleChangeRole(target, role)}
      onRemove={state.setRemoveTarget}
    />
  );

  return (
    <div>
      <div className="tiny mb-8">
        {hasRoster
          ? `${formatYearMonthLabel(data.rosterYearMonth ?? '')} 근무표 기준으로 이름을 연결해요. 이름 옆 숫자는 동명이인 순번, 뒤의 코드는 1~3일 근무예요.`
          : '아직 배포한 근무표가 없어요. 근무표를 배포하면 팀원과 이름을 연결할 수 있어요.'}
      </div>
      <div className="status-line" role="status" aria-live="polite">
        {state.message}
      </div>
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <h3 className="text-14">참여 요청 {pending.length}건</h3>
      {pending.length === 0 ? (
        <p className="mt-0">기다리는 요청이 없어요.</p>
      ) : (
        <ul className="member-list">{pending.map(renderMember)}</ul>
      )}
      <h3 className="text-14">팀원 {active.length}명</h3>
      <ul className="member-list">{active.map(renderMember)}</ul>
      <ConfirmDialog
        isOpen={state.removeTarget !== null}
        title={`${state.removeTarget?.displayName ?? ''}님을 내보낼까요?`}
        message="팀 근무 달이 그분의 달력과 공유 링크에서 바로 사라져요. 다시 참여하려면 초대 링크로 요청해야 해요."
        confirmLabel="내보내기"
        isDanger
        isBusy={state.busyUserId !== null}
        onConfirm={() => void state.handleRemove()}
        onCancel={() => state.setRemoveTarget(null)}
      />
    </div>
  );
};

export default TeamMembersPanel;
