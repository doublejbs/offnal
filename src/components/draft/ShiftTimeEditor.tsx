'use client';

import { Trash2 } from 'lucide-react';

import { formatShiftTime } from '@/client/DisplayText';
import { type DefinitionPatch, isCodeUsed } from '@/client/DraftEditing';
import { getShiftTone, toneClassName } from '@/client/ShiftStyle';
import AddCodeForm from '@/components/draft/AddCodeForm';
import { MAX_LABEL_LENGTH } from '@/domain/DomainLimits';
import { hasCompleteTimes } from '@/domain/ShiftTime';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

type ShiftTimeEditorProps = {
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  isOpen: boolean;
  disabled: boolean;
  onToggle: (isOpen: boolean) => void;
  onUpdate: (code: string, patch: DefinitionPatch) => void;
  onRemove: (code: string) => void;
  onAdd: (code: string, label: string) => string | null;
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

/** Times are never guessed: missing values stay empty until the user enters them. */
const ShiftTimeEditor = ({
  definitions,
  entries,
  isOpen,
  disabled,
  onToggle,
  onUpdate,
  onRemove,
  onAdd,
}: ShiftTimeEditorProps) => (
  <details
    open={isOpen}
    onToggle={(event) => onToggle(event.currentTarget.open)}
    style={{ margin: '16px 0' }}
  >
    <summary
      style={{ fontSize: 15, minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
    >
      근무 시간 확인 · 코드 관리
    </summary>
    <div style={{ marginTop: 8 }}>
      {definitions.map((definition) => {
        const isUsed = isCodeUsed(entries, definition.code);
        const isComplete = definition.isOff || hasCompleteTimes(definition);

        return (
          <fieldset key={definition.code} className="time-row" disabled={disabled} style={{ minWidth: 0 }}>
            <legend className="visually-hidden">{definition.code} 근무 시간</legend>
            <div className="time-row-head">
              <span className={toneClassName(getShiftTone(definition.code, definitions))}>
                {definition.code}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => onRemove(definition.code)}
                disabled={isUsed}
                aria-label={
                  isUsed
                    ? `${definition.code} 코드는 사용 중이라 삭제할 수 없어요`
                    : `${definition.code} 코드 삭제`
                }
                title={isUsed ? '사용 중인 코드는 삭제할 수 없어요' : '코드 삭제'}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
            <label className="inline-field" style={{ marginBottom: 8 }}>
              이름
              <input
                value={definition.label}
                maxLength={MAX_LABEL_LENGTH}
                onChange={(event) => onUpdate(definition.code, { label: event.target.value })}
              />
            </label>
            <label className="check" style={{ margin: '4px 0' }}>
              <input
                type="checkbox"
                checked={definition.isOff}
                onChange={(event) => onUpdate(definition.code, { isOff: event.target.checked })}
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
                      onChange={(event) =>
                        onUpdate(definition.code, { startTime: event.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    종료
                    <input
                      type="time"
                      value={definition.endTime ?? ''}
                      onChange={(event) => onUpdate(definition.code, { endTime: event.target.value || null })}
                    />
                  </label>
                </div>
                <label className="check" style={{ margin: '8px 0 0' }}>
                  <input
                    type="checkbox"
                    checked={definition.endsNextDay === true}
                    onChange={(event) => onUpdate(definition.code, { endsNextDay: event.target.checked })}
                  />
                  다음 날 종료
                </label>
              </>
            )}
            <div className="status-line" data-tone={isComplete ? undefined : 'warn'} style={{ marginTop: 8 }}>
              {describeTimeStatus(definition)}
              {!isUsed && ' · 사용하지 않는 코드'}
            </div>
          </fieldset>
        );
      })}
      <AddCodeForm submitLabel="코드 추가" onAdd={onAdd} />
    </div>
  </details>
);

export default ShiftTimeEditor;
