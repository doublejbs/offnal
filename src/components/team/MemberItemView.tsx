'use client';

import { useState } from 'react';

import { describeMembershipBadge, formatJoinableRow, formatRowKey } from '@/client/TeamDisplayText';
import RowPicker from '@/components/team/RowPicker';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';

type MemberItemViewProps = {
  member: TeamMemberDto;
  /** Free rows of the latest published roster. */
  availableRows: JoinableRowDto[];
  hasRoster: boolean;
  isBusy: boolean;
  onApprove: (member: TeamMemberDto, rowKey: string | null | undefined) => void;
  onReject: (member: TeamMemberDto) => void;
  onChangeRow: (member: TeamMemberDto, rowKey: string | null) => void;
  onChangeRole: (member: TeamMemberDto, role: TeamRole) => void;
  onRemove: (member: TeamMemberDto) => void;
};

const describeLinkedRow = (member: TeamMemberDto): string => {
  if (member.linkedRow) {
    return formatJoinableRow(member.linkedRow);
  }

  return member.linkedRowKey
    ? `${formatRowKey(member.linkedRowKey)} (최근 근무표에 없음)`
    : '연결된 이름 없음';
};

/** The member's own row first, then the free rows (no duplicates). */
const buildRowOptions = (member: TeamMemberDto, availableRows: JoinableRowDto[]): JoinableRowDto[] => {
  const own = member.linkedRow ? [member.linkedRow] : [];

  return [...own, ...availableRows.filter((row) => row.rowKey !== member.linkedRow?.rowKey)];
};

/** One member or join request with its actions. Admins can link their own row too (not change their role here). */
const MemberItemView = ({
  member,
  availableRows,
  hasRoster,
  isBusy,
  onApprove,
  onReject,
  onChangeRow,
  onChangeRole,
  onRemove,
}: MemberItemViewProps) => {
  const [rowKey, setRowKey] = useState<string | null>(member.linkedRow?.rowKey ?? null);
  const options = buildRowOptions(member, availableRows);
  const isPending = member.status === TeamMemberStatus.PENDING;
  const rowChanged = rowKey !== (member.linkedRow?.rowKey ?? null);

  return (
    <li className="member-item">
      <div className="member-head">
        <strong>
          {member.displayName}
          {member.isMe && ' (나)'}
        </strong>
        <span
          className="role-badge"
          data-tone={isPending ? 'pending' : member.role === TeamRole.ADMIN ? 'admin' : 'member'}
        >
          {describeMembershipBadge(member.role, member.status)}
        </span>
      </div>
      <div className="tiny">
        {isPending ? '요청한 이름: ' : '근무표 이름: '}
        {describeLinkedRow(member)}
      </div>
      {hasRoster && (
        <RowPicker
          label={isPending ? '승인할 근무표 행' : '연결할 근무표 행'}
          rows={options}
          value={rowKey}
          noRowLabel={isPending ? '행 없이 승인 (나중에 연결)' : '연결 끊기'}
          disabled={isBusy}
          onChange={setRowKey}
        />
      )}
      {isPending ? (
        <div className="actionrow">
          <button type="button" className="secondary" disabled={isBusy} onClick={() => onReject(member)}>
            거절
          </button>
          <button
            type="button"
            className="primary"
            disabled={isBusy}
            onClick={() => onApprove(member, hasRoster && rowChanged ? rowKey : undefined)}
          >
            {isBusy ? '처리 중…' : '승인'}
          </button>
        </div>
      ) : (
        <div className="member-actions">
          {hasRoster && (
            <button
              type="button"
              className="secondary"
              disabled={isBusy || !rowChanged}
              onClick={() => onChangeRow(member, rowKey)}
            >
              행 연결 저장
            </button>
          )}
          {!member.isMe && (
            <>
              <button
                type="button"
                className="secondary"
                disabled={isBusy}
                onClick={() =>
                  onChangeRole(member, member.role === TeamRole.ADMIN ? TeamRole.MEMBER : TeamRole.ADMIN)
                }
              >
                {member.role === TeamRole.ADMIN ? '관리자 해제' : '관리자로 지정'}
              </button>
              <button type="button" className="danger" disabled={isBusy} onClick={() => onRemove(member)}>
                내보내기
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
};

export default MemberItemView;
