'use client';

import { formatFirstCodes, formatSameNameLabel } from '@/client/TeamDisplayText';
import { NO_ROW_CHOICE } from '@/components/join/UseJoinState';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';

type JoinRowPickerProps = {
  rows: JoinableRowDto[];
  choice: string | null;
  disabled: boolean;
  onChange: (choice: string) => void;
};

/** "근무표에서 내 이름을 골라 주세요": name, ordinal when duplicated, and the first 3 days' codes. */
const JoinRowPicker = ({ rows, choice, disabled, onChange }: JoinRowPickerProps) => (
  <fieldset className="plain-fieldset" disabled={disabled}>
    <legend className="text-14 mb-8">근무표에서 내 이름을 골라 주세요</legend>
    {rows.map((row) => (
      <label key={row.rowKey} className="person">
        <span>
          <strong>{formatSameNameLabel(row.displayName, row.sameNameOrdinal, row.sameNameCount)}</strong>
          {row.firstCodes.length > 0 && (
            <small className="block-text tiny">
              1~{row.firstCodes.length}일 {formatFirstCodes(row.firstCodes)}
            </small>
          )}
        </span>
        <input
          type="radio"
          name="join-row"
          value={row.rowKey}
          checked={choice === row.rowKey}
          onChange={() => onChange(row.rowKey)}
        />
      </label>
    ))}
    <label className="person">
      <span>
        <strong>목록에 내 이름이 없어요</strong>
        <small className="block-text tiny">관리자가 승인할 때 근무표의 행을 연결해 줘요</small>
      </span>
      <input
        type="radio"
        name="join-row"
        value={NO_ROW_CHOICE}
        checked={choice === NO_ROW_CHOICE}
        onChange={() => onChange(NO_ROW_CHOICE)}
      />
    </label>
  </fieldset>
);

export default JoinRowPicker;
