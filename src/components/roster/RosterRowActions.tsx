'use client';

import { type FormEvent, useState } from 'react';

import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';

type RosterRowActionsProps = {
  row: TeamRosterRowDto;
  disabled: boolean;
  onRename: (rowId: string, displayName: string) => void;
  onToggleExcluded: (rowId: string, excluded: boolean) => void;
};

/** Per-row "이름 수정" (row key and linked member stay) and "제외" (not a worker, e.g. a "-" only row). */
const RosterRowActions = ({ row, disabled, onRename, onToggleExcluded }: RosterRowActionsProps) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(row.displayName);

  /** Committed on blur / Enter (trimmed), so autosave never fights the text being typed. */
  const handleCommitName = () => {
    const trimmed = nameInput.trim();

    if (trimmed.length > 0 && trimmed !== row.displayName) {
      onRename(row.id, trimmed);
    }
  };

  const handleSubmitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleCommitName();
    setIsRenaming(false);
  };

  const handleToggleRename = () => {
    setNameInput(row.displayName);
    setIsRenaming((value) => !value);
  };

  return (
    <div className="row-actions">
      <div className="tiny">
        {row.linkedMember ? `연결된 팀원: ${row.linkedMember.displayName}` : '연결된 팀원 없음'}
        {row.isNewPerson && ' · 이전 근무표에 없던 사람'}
      </div>
      {isRenaming && (
        <form className="add-row-form" onSubmit={handleSubmitName} aria-label="이름 수정">
          <label className="inline-field">
            근무표 이름
            <input
              value={nameInput}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              disabled={disabled}
              onChange={(event) => setNameInput(event.target.value)}
              onBlur={handleCommitName}
            />
          </label>
          <button type="submit" className="secondary" disabled={disabled || nameInput.trim().length === 0}>
            저장
          </button>
        </form>
      )}
      <div className="actionrow">
        <button
          type="button"
          className="secondary"
          aria-expanded={isRenaming}
          disabled={disabled}
          onClick={handleToggleRename}
        >
          {isRenaming ? '이름 수정 닫기' : '이름 수정'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => onToggleExcluded(row.id, !row.excluded)}
        >
          {row.excluded ? '다시 포함' : '이 행 제외'}
        </button>
      </div>
      {row.excluded && <div className="tiny mt-8">제외한 행은 배포되지 않고 팀원에게도 보이지 않아요.</div>}
    </div>
  );
};

export default RosterRowActions;
