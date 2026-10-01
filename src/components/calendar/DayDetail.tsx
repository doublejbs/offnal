import { formatShiftTime } from '@/client/DisplayText';
import { formatDayLabel } from '@/client/MonthLayout';
import { getShiftTone, toneClassName } from '@/client/ShiftStyle';
import { formatCellChange } from '@/client/TeamDisplayText';
import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

type DayDetailProps = {
  date: string;
  code: string | null;
  definitions: ShiftDefinition[];
  /** Team months: what this date was before the latest change. */
  change?: TeamCellChange;
};

/** Read-only detail of one day: code, label and time range (with "다음 날" for overnight shifts). */
const DayDetail = ({ date, code, definitions, change }: DayDetailProps) => {
  const definition = definitions.find((item) => item.code === code);

  return (
    <section className="editor" aria-live="polite" aria-label="선택한 날짜">
      <div className="edithead">
        <strong>{formatDayLabel(date)}</strong>
        {code && <span className={toneClassName(getShiftTone(code, definitions))}>{code}</span>}
      </div>
      <div className="time">
        {code === null ? '근무가 없어요' : `${definition?.label ?? code} · ${formatShiftTime(definition)}`}
      </div>
      {change && (
        <div className="status-line mt-8" data-tone="warn">
          변경: {formatCellChange(change)}
        </div>
      )}
    </section>
  );
};

export default DayDetail;
