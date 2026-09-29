import { formatShiftTime } from '@/client/DisplayText';
import { formatDayLabel } from '@/client/MonthLayout';
import { getShiftTone, toneClassName } from '@/client/ShiftStyle';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

type DayDetailProps = {
  date: string;
  code: string | null;
  definitions: ShiftDefinition[];
};

/** Read-only detail of one day: code, label and time range (with "다음 날" for overnight shifts). */
const DayDetail = ({ date, code, definitions }: DayDetailProps) => {
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
    </section>
  );
};

export default DayDetail;
