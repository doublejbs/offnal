import { countWorkAndOff } from '@/domain/ScheduleStats';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type MonthHeadingProps = {
  displayName: string;
  yearMonth: string;
  entries: ShiftEntry[];
  definitions: ShiftDefinition[];
};

/** "{name}님의 근무", the month title and work/off counts (owner and shared calendars). */
const MonthHeading = ({ displayName, yearMonth, entries, definitions }: MonthHeadingProps) => {
  const counts = countWorkAndOff(entries, definitions);

  return (
    <div className="calendarhead">
      <div className="min-w-0">
        <div className="tiny">{displayName}님의 근무</div>
        <h1>{formatYearMonthLabel(yearMonth)}</h1>
      </div>
      <span className="tiny flex-none">
        근무 {counts.workCount} · 휴무 {counts.offCount}
      </span>
    </div>
  );
};

export default MonthHeading;
