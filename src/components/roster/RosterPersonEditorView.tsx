'use client';

import { ChevronLeft } from 'lucide-react';

import { formatRowName } from '@/client/TeamDisplayText';
import { countRowReview } from '@/client/TeamRosterGrid';
import MonthGrid from '@/components/calendar/MonthGrid';
import RosterCellEditorView from '@/components/roster/RosterCellEditorView';
import { type RosterEditHandlers } from '@/components/roster/UseRosterEdits';
import { type RosterCell } from '@/components/roster/UseRosterReviewState';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

type RosterPersonEditorViewProps = {
  row: TeamRosterRowDto;
  yearMonth: string;
  definitions: ShiftDefinition[];
  selected: RosterCell | null;
  edits: RosterEditHandlers;
  onSelect: (cell: RosterCell) => void;
  onBack: () => void;
};

/** Mobile: the existing month editor (MonthGrid + ShiftEditor) for one person, with a way back to the list. */
const RosterPersonEditorView = ({
  row,
  yearMonth,
  definitions,
  selected,
  edits,
  onSelect,
  onBack,
}: RosterPersonEditorViewProps) => {
  const date = selected?.rowId === row.id ? selected.date : (row.entries[0]?.date ?? null);
  const reviewCount = countRowReview(row);

  return (
    <section aria-label={`${row.displayName} 근무 확인`}>
      <button type="button" className="back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" />
        사람 목록으로
      </button>
      <h2 tabIndex={-1} data-person-heading>
        {formatRowName(row)}
      </h2>
      <div className="status-line" data-tone={reviewCount > 0 ? 'warn' : undefined} role="status">
        {row.excluded
          ? '제외한 행이에요'
          : reviewCount > 0
            ? `확인 필요 ${reviewCount}칸`
            : '모든 날짜를 확인했어요'}
      </div>
      <div className="mt-12">
        <MonthGrid
          yearMonth={yearMonth}
          entries={row.entries}
          definitions={definitions}
          selectedDate={date}
          onSelectDate={(next) => onSelect({ rowId: row.id, date: next })}
        />
      </div>
      {date && (
        <RosterCellEditorView
          row={row}
          date={date}
          definitions={definitions}
          edits={edits}
          isDocked={false}
        />
      )}
    </section>
  );
};

export default RosterPersonEditorView;
