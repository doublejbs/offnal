'use client';

import { useRef } from 'react';

import { formatSameNameLabel } from '@/client/TeamDisplayText';
import ShiftEditor from '@/components/draft/ShiftEditor';
import RosterRowActions from '@/components/roster/RosterRowActions';
import { type RosterEditHandlers } from '@/components/roster/UseRosterEdits';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

type RosterCellEditorViewProps = {
  row: TeamRosterRowDto;
  date: string;
  definitions: ShiftDefinition[];
  edits: RosterEditHandlers;
  /** Desktop: docked under the table. */
  isDocked: boolean;
};

/** Bottom editor of the selected cell (reuses ShiftEditor) plus the row's name/exclude actions. */
const RosterCellEditorView = ({ row, date, definitions, edits, isDocked }: RosterCellEditorViewProps) => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const entry = row.entries.find((item) => item.date === date);
  const hasSourceCells = row.sourceCells.length > 0;
  const rawText = hasSourceCells ? row.sourceCells.find((cell) => cell.date === date)?.rawText : undefined;
  const disabled = !edits.canEdit;

  return (
    <div className={isDocked ? 'roster-dock' : undefined} data-roster-editor tabIndex={-1}>
      <div className="edithead mb-0">
        <strong>{formatSameNameLabel(row.displayName, row.sameNameOrdinal, row.sameNameCount)}</strong>
      </div>
      {entry && !row.excluded && (
        <ShiftEditor
          entry={entry}
          rawText={rawText}
          definitions={definitions}
          disabled={disabled}
          hasSourceCells={hasSourceCells}
          sectionRef={sectionRef}
          onSelectCode={(code) => edits.handleSelectCode(row.id, date, code)}
          onAddCode={(code, label) => edits.handleAddCode(code, label, { rowId: row.id, date })}
        />
      )}
      <RosterRowActions
        key={row.id}
        row={row}
        disabled={disabled}
        onRename={edits.handleRename}
        onToggleExcluded={edits.handleToggleExcluded}
      />
    </div>
  );
};

export default RosterCellEditorView;
