'use client';

import { Trash2 } from 'lucide-react';

import { formatShiftTime } from '@/client/DisplayText';
import { type DefinitionPatch } from '@/client/DraftEditing';
import { getShiftTone, toneClassName } from '@/client/ShiftStyle';
import { MAX_LABEL_LENGTH } from '@/domain/DomainLimits';
import { hasCompleteTimes } from '@/domain/ShiftTime';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

type ShiftTimeRowProps = {
  definition: ShiftDefinition;
  definitions: ShiftDefinition[];
  isUsed: boolean;
  disabled: boolean;
  onUpdate: (code: string, patch: DefinitionPatch) => void;
  onRemove: (code: string) => void;
};

const describeTimeStatus = (definition: ShiftDefinition): string => {
  if (definition.isOff || hasCompleteTimes(definition)) {
    return formatShiftTime(definition);
  }

  if (definition.startTime && definition.endTime) {
    return '시작·종료 시각과 다음 날 종료 여부를 확인해 주세요';
  }

  return '시간을 입력해 주세요';
};

/** One code: label, off flag, start/end, next-day flag and delete (only when unused). */
const ShiftTimeRow = ({
  definition,
  definitions,
  isUsed,
  disabled,
  onUpdate,
  onRemove,
}: ShiftTimeRowProps) => {
  const { code } = definition;
  const isComplete = definition.isOff || hasCompleteTimes(definition);

  return (
    <fieldset className="time-row" disabled={disabled}>
      <legend className="visually-hidden">{code} 근무 시간</legend>
      <div className="time-row-head">
        <span className={toneClassName(getShiftTone(code, definitions))}>{code}</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => onRemove(code)}
          disabled={isUsed}
          aria-label={isUsed ? `${code} 코드는 사용 중이라 삭제할 수 없어요` : `${code} 코드 삭제`}
          title={isUsed ? '사용 중인 코드는 삭제할 수 없어요' : '코드 삭제'}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <label className="inline-field mb-8">
        이름
        <input
          value={definition.label}
          maxLength={MAX_LABEL_LENGTH}
          onChange={(event) => onUpdate(code, { label: event.target.value })}
        />
      </label>
      <label className="check my-4">
        <input
          type="checkbox"
          checked={definition.isOff}
          onChange={(event) => onUpdate(code, { isOff: event.target.checked })}
        />
        휴무 (근무 시간 없음)
      </label>
      {!definition.isOff && (
        <>
          <div className="time-grid">
            <label>
              시작
              <input
                type="time"
                value={definition.startTime ?? ''}
                onChange={(event) => onUpdate(code, { startTime: event.target.value || null })}
              />
            </label>
            <label>
              종료
              <input
                type="time"
                value={definition.endTime ?? ''}
                onChange={(event) => onUpdate(code, { endTime: event.target.value || null })}
              />
            </label>
          </div>
          <label className="check mt-8 mb-0">
            <input
              type="checkbox"
              checked={definition.endsNextDay === true}
              onChange={(event) => onUpdate(code, { endsNextDay: event.target.checked })}
            />
            다음 날 종료
          </label>
        </>
      )}
      <div className="status-line mt-8" data-tone={isComplete ? undefined : 'warn'}>
        {describeTimeStatus(definition)}
        {!isUsed && ' · 사용하지 않는 코드'}
      </div>
    </fieldset>
  );
};

export default ShiftTimeRow;
