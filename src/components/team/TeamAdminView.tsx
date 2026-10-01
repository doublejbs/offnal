'use client';

import { Link as LinkIcon, Settings, Upload, Users } from 'lucide-react';
import { useState } from 'react';

import BackLink from '@/components/BackLink';
import DisclosureRow from '@/components/team/DisclosureRow';
import LeaveTeamButton from '@/components/team/LeaveTeamButton';
import RosterUploadForm from '@/components/team/RosterUploadForm';
import TeamDeleteSection from '@/components/team/TeamDeleteSection';
import TeamInvitesPanel from '@/components/team/TeamInvitesPanel';
import TeamMembersPanel from '@/components/team/TeamMembersPanel';
import TeamRosterSection from '@/components/team/TeamRosterSection';
import TeamSettingsPanel from '@/components/team/TeamSettingsPanel';
import { TeamAdminPanel } from '@/domain/enums/TeamAdminPanel';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';

type TeamAdminViewProps = {
  detail: TeamDetailResponse;
  onDetailChange: (detail: TeamDetailResponse) => void;
};

/** Admin view of `/teams/:id`: this month's roster, upload, members, invites, settings, delete. */
const TeamAdminView = ({ detail, onDetailChange }: TeamAdminViewProps) => {
  const [openPanel, setOpenPanel] = useState<TeamAdminPanel | null>(
    detail.pendingRequestCount > 0 ? TeamAdminPanel.MEMBERS : null,
  );
  const { team } = detail;

  const handleToggle = (panel: TeamAdminPanel) =>
    setOpenPanel((current) => (current === panel ? null : panel));

  return (
    <>
      <BackLink href="/teams" label="내 팀" />
      <div className="label">관리자</div>
      <h1>{team.name}</h1>
      {detail.pendingRequestCount > 0 && (
        <div className="notice" role="status">
          참여 요청 {detail.pendingRequestCount}건이 승인을 기다리고 있어요.
        </div>
      )}
      <TeamRosterSection detail={detail} />
      <DisclosureRow
        isOpen={openPanel === TeamAdminPanel.UPLOAD}
        icon={<Upload size={20} aria-hidden="true" />}
        title="근무표 올리기"
        description="사진 한 장으로 팀원 모두의 근무를 읽어요"
        onToggle={() => handleToggle(TeamAdminPanel.UPLOAD)}
      >
        <RosterUploadForm teamId={team.id} />
      </DisclosureRow>
      <DisclosureRow
        isOpen={openPanel === TeamAdminPanel.MEMBERS}
        icon={<Users size={20} aria-hidden="true" />}
        title="팀원 관리"
        description="참여 요청 승인, 근무표 행 연결, 관리자 지정"
        badge={detail.pendingRequestCount > 0 ? `요청 ${detail.pendingRequestCount}` : null}
        onToggle={() => handleToggle(TeamAdminPanel.MEMBERS)}
      >
        <TeamMembersPanel
          teamId={team.id}
          onPendingCountChange={(count) => onDetailChange({ ...detail, pendingRequestCount: count })}
        />
      </DisclosureRow>
      <DisclosureRow
        isOpen={openPanel === TeamAdminPanel.INVITES}
        icon={<LinkIcon size={20} aria-hidden="true" />}
        title="초대 링크"
        description="단톡방에 보내면 팀원이 참여를 요청해요"
        onToggle={() => handleToggle(TeamAdminPanel.INVITES)}
      >
        <TeamInvitesPanel teamId={team.id} teamName={team.name} />
      </DisclosureRow>
      <DisclosureRow
        isOpen={openPanel === TeamAdminPanel.SETTINGS}
        icon={<Settings size={20} aria-hidden="true" />}
        title="팀 설정"
        description="팀 이름, 팀원끼리 전체 근무표 보기"
        onToggle={() => handleToggle(TeamAdminPanel.SETTINGS)}
      >
        <TeamSettingsPanel detail={detail} onSaved={onDetailChange} />
      </DisclosureRow>
      <div className="mt-20">
        <LeaveTeamButton teamId={team.id} teamName={team.name} />
      </div>
      <TeamDeleteSection teamId={team.id} teamName={team.name} />
    </>
  );
};

export default TeamAdminView;
