'use client';

import { Plus } from 'lucide-react';
import { type RefObject, useId, useState } from 'react';

import { describeReviewReason, formatRawText, formatShiftTime } from '@/client/DisplayText';
import { formatDayLabel } from '@/client/MonthLayout';
import AddCodeForm from '@/components/draft/AddCodeForm';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

type ShiftEditorProps = {
  entry: ShiftEntry;
  /** undefined = no source row for this draft (manual/edit drafts). */
  rawText: string | null | undefined;
  definitions: ShiftDefinition[];
  disabled: boolean;
  sectionRef: RefObject<HTMLElement | null>;
  onSelectCode: (code: string | null) => void;
  onAddCode: (code: string, label: string) => string | null;
};

/** Editing area under the grid for the selected date. Picking a code confirms the date. */
const ShiftEditor = ({
  entry,
  rawText,
  definitions,
  disabled,
  sectionRef,
  onSelectCode,
  onAddCode,
}: ShiftEditorProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const titleId = useId();
  const definition = definitions.find((item) => item.code === entry.code);
  const isUnconfirmed = entry.code === null || !entry.confirmed;

  const handleAdd = (code: string, label: string): string | null => {
    const error = onAddCode(code, label);

    if (!error) {
      setIsAdding(false);
    }

    return error;
  };

  return (
    <section ref={sectionRef} className="editor" aria-labelledby={titleId} tabIndex={-1}>
      <div className="edithead">
        <strong id={titleId}>{formatDayLabel(entry.date)}</strong>
        <span className="tiny">{isUnconfirmed ? '확인 필요' : '근무 수정'}</span>
      </div>
      {rawText !== undefined && <div className="tiny mb-8">원본: {formatRawText(rawText)}</div>}
      {isUnconfirmed && entry.reviewReasons.length > 0 && (
        <div className="status-line mb-10" data-tone="warn">
          {entry.reviewReasons.map(describeReviewReason).join(' · ')}
        </div>
      )}
      <div className="choices" role="group" aria-label="근무 코드 선택">
        {definitions.map((item) => (
          <button
            key={item.code}
            type="button"
            aria-pressed={entry.confirmed && entry.code === item.code}
            aria-label={`${item.code} ${item.label}`}
            disabled={disabled}
            onClick={() => onSelectCode(item.code)}
          >
            {item.code}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={entry.code === null}
          disabled={disabled}
          onClick={() => onSelectCode(null)}
        >
          미확인
        </button>
        <button
          type="button"
          aria-expanded={isAdding}
          disabled={disabled}
          onClick={() => setIsAdding((value) => !value)}
        >
          <Plus size={14} aria-hidden="true" className="icon-inline" /> 코드 추가
        </button>
      </div>
      {isAdding && (
        <AddCodeForm
          submitLabel="추가하고 이 날짜에 적용"
          onAdd={handleAdd}
          onCancel={() => setIsAdding(false)}
        />
      )}
      <div className="time">
        {entry.code === null
          ? '원본을 확인하고 근무를 선택해 주세요.'
          : `${definition?.label ?? entry.code} · ${formatShiftTime(definition)}`}
        {entry.code !== null && !entry.confirmed && ' · 맞으면 코드를 한 번 눌러 확인해 주세요.'}
      </div>
    </section>
  );
};

export default ShiftEditor;
