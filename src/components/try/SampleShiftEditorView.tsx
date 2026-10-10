import { useId } from 'react';

import { describeReviewReason, formatRawText, formatShiftTime } from '@/client/DisplayText';
import { formatDayLabel } from '@/client/MonthLayout';
import { SAMPLE_DEFINITIONS } from '@/client/SamplePreviewData';
import { isEntryUnconfirmed } from '@/client/ShiftStyle';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

type SampleShiftEditorViewProps = {
  entry: ShiftEntry;
  /** The code printed in the photo for this day. */
  printedCode: string;
  /** The photo's smudged cell: recognition could not read it (the code is only faintly visible). */
  isSmudged: boolean;
  onSelectCode: (code: string) => void;
};

/**
 * Editing area under the grid, in the real editor's layout (`ShiftEditor`) with only the code choices:
 * the trial has no custom codes or 미확인 to go back to.
 */
const SampleShiftEditorView = ({
  entry,
  printedCode,
  isSmudged,
  onSelectCode,
}: SampleShiftEditorViewProps) => {
  const titleId = useId();
  const definition = SAMPLE_DEFINITIONS.find((item) => item.code === entry.code);
  const isUnconfirmed = isEntryUnconfirmed(entry);

  return (
    <section className="editor" aria-labelledby={titleId}>
      <div className="edithead">
        <strong id={titleId}>{formatDayLabel(entry.date)}</strong>
        <span className="tiny">{isUnconfirmed ? '확인 필요' : '근무 수정'}</span>
      </div>
      <div className="tiny mb-8">원본: {formatRawText(isSmudged ? null : printedCode)}</div>
      {isUnconfirmed && entry.reviewReasons.length > 0 && (
        <div className="status-line mb-10" data-tone="warn">
          {entry.reviewReasons.map(describeReviewReason).join(' · ')}
        </div>
      )}
      {isUnconfirmed && isSmudged && <div className="tiny mb-10">{`사진 속 흐린 글자: ${printedCode}`}</div>}
      <div className="choices" role="group" aria-label="근무 코드 선택">
        {SAMPLE_DEFINITIONS.map((item) => (
          <button
            key={item.code}
            type="button"
            aria-pressed={entry.confirmed && entry.code === item.code}
            aria-label={`${item.code} ${item.label}`}
            onClick={() => onSelectCode(item.code)}
          >
            {item.code}
          </button>
        ))}
      </div>
      <div className="time">
        {entry.code === null
          ? '원본을 확인하고 근무를 선택해 주세요.'
          : `${definition?.label ?? entry.code} · ${formatShiftTime(definition)}`}
      </div>
    </section>
  );
};

export default SampleShiftEditorView;
