'use client';

import { Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { getRosterSourceUrl } from '@/client/TeamApiClient';
import BackLink from '@/components/BackLink';
import SaveStatus from '@/components/draft/SaveStatus';
import { type RosterAutosave } from '@/components/roster/UseRosterAutosave';
import { type RosterEditHandlers } from '@/components/roster/UseRosterEdits';
import SourcePreview from '@/components/SourcePreview';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { formatYearMonthLabel, isValidYearMonth } from '@/domain/YearMonth';

type RosterReviewHeaderProps = {
  teamId: string;
  view: TeamRosterResponse;
  includedCount: number;
  reviewCellCount: number;
  autosave: RosterAutosave;
  edits: RosterEditHandlers;
  onReload: () => void;
};

/** Title, month (remaps every row by day number), autosave status and the original photo. */
const RosterReviewHeader = ({
  teamId,
  view,
  includedCount,
  reviewCellCount,
  autosave,
  edits,
  onReload,
}: RosterReviewHeaderProps) => {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [monthInput, setMonthInput] = useState<string | null>(null);
  const yearMonth = view.roster.yearMonth ?? '';

  const pendingMonth =
    monthInput !== null && isValidYearMonth(monthInput) && monthInput !== yearMonth ? monthInput : null;

  /** Explicit button: a month change remaps every row, so it never fires on each keystroke. */
  const handleApplyMonth = async () => {
    if (pendingMonth && (await edits.handleChangeMonth(pendingMonth))) {
      setMonthInput(null);
    }
  };

  return (
    <>
      <BackLink href={`/teams/${teamId}`} label="팀으로" />
      <div className="label">2 / 2 · 전체 확인 · {includedCount}명</div>
      <h1>
        {yearMonth ? `${formatYearMonthLabel(yearMonth)} 근무표를 확인해 주세요` : '근무표를 확인해 주세요'}
      </h1>
      <p className="mt-0">
        {reviewCellCount > 0
          ? `확인이 필요한 칸이 ${reviewCellCount}개 있어요. 주황색 칸을 눌러 원본과 비교해 고쳐 주세요.`
          : '모든 칸을 확인했어요. 근무 시간을 확인하고 배포해 주세요.'}
      </p>
      <div className="add-row-form mt-0">
        <label className="inline-field">
          대상 월
          <input
            type="month"
            value={monthInput ?? yearMonth}
            onChange={(event) => setMonthInput(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!edits.canEdit || pendingMonth === null}
          onClick={() => void handleApplyMonth()}
        >
          월 바꾸기
        </button>
      </div>
      {pendingMonth && <div className="tiny">바꾸면 모든 사람의 근무가 날짜(일) 기준으로 옮겨져요.</div>}
      {edits.actionError && (
        <div className="warning" role="alert">
          {edits.actionError}
        </div>
      )}
      <SaveStatus
        saveState={autosave.saveState}
        saveMessage={autosave.saveMessage}
        onRetry={() => void autosave.flush()}
        onReload={onReload}
      />
      {view.roster.sourceAvailable && (
        <button
          type="button"
          className="textbutton"
          aria-expanded={isSourceOpen}
          onClick={() => setIsSourceOpen((value) => !value)}
        >
          <ImageIcon size={16} aria-hidden="true" />
          {isSourceOpen ? '원본 사진 닫기' : '원본 사진 크게 보기'}
        </button>
      )}
      {isSourceOpen && (
        <SourcePreview src={getRosterSourceUrl(teamId, view.roster.id)} alt="팀 근무표 원본" />
      )}
    </>
  );
};

export default RosterReviewHeader;
