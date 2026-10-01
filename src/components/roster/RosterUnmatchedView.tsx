'use client';

import { useId, useState } from 'react';

import { formatRowName } from '@/client/TeamDisplayText';
import { listRenameCandidates } from '@/client/TeamRosterGrid';
import { type PreviousRowRef } from '@/domain/types/api/PreviousRowRef';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';

type RosterUnmatchedViewProps = {
  unmatched: PreviousRowRef[];
  rows: TeamRosterRowDto[];
  disabled: boolean;
  onMatch: (rowId: string, rowKey: string) => Promise<boolean>;
  onDismiss: (rowKey: string) => void;
};

type UnmatchedItemProps = {
  previous: PreviousRowRef;
  candidates: TeamRosterRowDto[];
  disabled: boolean;
  onMatch: (rowId: string, rowKey: string) => Promise<boolean>;
  onDismiss: (rowKey: string) => void;
};

const UnmatchedItem = ({ previous, candidates, disabled, onMatch, onDismiss }: UnmatchedItemProps) => {
  const [pickedRowId, setRowId] = useState<string | null>(null);
  // Fall back to the first candidate when the pick disappeared after a reload.
  const rowId = candidates.some((row) => row.id === pickedRowId)
    ? (pickedRowId ?? '')
    : (candidates[0]?.id ?? '');

  return (
    <li className="member-item">
      <strong>이전 근무표의 {formatRowName(previous)}님이 안 보여요</strong>
      {previous.linked && (
        <div className="tiny">팀원과 연결된 행이에요. 이대로 배포하면 그분 달력에서 이 달이 사라져요.</div>
      )}
      {candidates.length > 0 ? (
        <>
          <label className="inline-field mt-8">
            이름이 바뀌었다면 새 근무표의 행
            <select value={rowId} disabled={disabled} onChange={(event) => setRowId(event.target.value)}>
              {candidates.map((row) => (
                <option key={row.id} value={row.id}>
                  {formatRowName(row)}
                </option>
              ))}
            </select>
          </label>
          <div className="actionrow">
            <button
              type="button"
              className="secondary"
              disabled={disabled || rowId === ''}
              onClick={() => void onMatch(rowId, previous.rowKey)}
            >
              이름 바뀜 · 이어 주기
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => onDismiss(previous.rowKey)}
            >
              빠졌어요
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="secondary mt-8"
          disabled={disabled}
          onClick={() => onDismiss(previous.rowKey)}
        >
          빠졌어요 (확인)
        </button>
      )}
    </li>
  );
};

/** People of the latest published revision this draft lost: "이름 바뀜" (matchRowKey) or "빠짐". */
const RosterUnmatchedView = ({ unmatched, rows, disabled, onMatch, onDismiss }: RosterUnmatchedViewProps) => {
  const titleId = useId();
  const candidates = listRenameCandidates(rows);

  if (unmatched.length === 0) {
    return null;
  }

  return (
    <section className="block" aria-labelledby={titleId}>
      <h2 id={titleId}>이전 근무표와 달라진 사람 {unmatched.length}명</h2>
      <p className="mt-0">
        이름이 바뀌었으면 새 행과 이어 주세요. 연결된 팀원은 이어 준 행으로 계속 달력을 받아요.
      </p>
      <ul className="member-list">
        {unmatched.map((previous) => (
          <UnmatchedItem
            key={previous.rowKey}
            previous={previous}
            candidates={candidates}
            disabled={disabled}
            onMatch={onMatch}
            onDismiss={onDismiss}
          />
        ))}
      </ul>
    </section>
  );
};

export default RosterUnmatchedView;
