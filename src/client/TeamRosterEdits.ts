import { validateDraftInput } from '@/client/DraftEditing';
import { resolveDefinedCodes } from '@/domain/DefinedCodeResolver';
import { getPublishBlockers, summarizeReview } from '@/domain/ScheduleValidator';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/** Unsaved roster edits: the legend and per-row fields, merged until the next PATCH. Pure. */

export type RosterRowEdit = {
  displayName?: string;
  entries?: ShiftEntry[];
  excluded?: boolean;
};

export type RosterEdits = {
  definitions?: ShiftDefinition[];
  rows: Record<string, RosterRowEdit>;
};

export const EMPTY_EDITS: RosterEdits = { rows: {} };

export const isEmptyEdits = (edits: RosterEdits): boolean =>
  edits.definitions === undefined && Object.keys(edits.rows).length === 0;

/** Later edits win field by field. */
export const mergeEdits = (earlier: RosterEdits, later: RosterEdits): RosterEdits => {
  const rows: Record<string, RosterRowEdit> = { ...earlier.rows };

  for (const [rowId, edit] of Object.entries(later.rows)) {
    rows[rowId] = { ...rows[rowId], ...edit };
  }

  return { definitions: later.definitions ?? earlier.definitions, rows };
};

const applyRowEdit = (row: TeamRosterRowDto, edit: RosterRowEdit | undefined): TeamRosterRowDto =>
  edit ? { ...row, ...edit } : row;

/**
 * The roster as the admin sees it with unsaved edits applied, including what the server would derive:
 * defined codes confirm their dates (resolveDefinedCodes), review counts and blockers follow.
 */
export const applyEdits = (roster: TeamRosterResponse, edits: RosterEdits): TeamRosterResponse => {
  if (isEmptyEdits(edits)) {
    return roster;
  }

  const definitions = edits.definitions ?? roster.definitions;
  const rows = roster.rows.map((row) => {
    const edited = applyRowEdit(row, edits.rows[row.id]);
    const entries = resolveDefinedCodes(edited.entries, definitions);

    return {
      ...edited,
      entries,
      reviewCount: summarizeReview(entries).count,
      blockers: edited.excluded ? [] : getPublishBlockers(entries, definitions),
    };
  });

  return { ...roster, definitions, rows };
};

export const toPatchBody = (version: number, edits: RosterEdits): PatchTeamRosterRequest => {
  const rows = Object.entries(edits.rows).map(([rowId, edit]) => ({
    rowId,
    ...edit,
    ...(edit.displayName === undefined ? {} : { displayName: edit.displayName.trim() }),
  }));

  return {
    version,
    ...(edits.definitions ? { definitions: edits.definitions } : {}),
    ...(rows.length > 0 ? { rows } : {}),
  };
};

/** Client guard so autosave never sends what the server rejects (empty names, empty code labels). */
export const validateEdits = (edits: RosterEdits): string | null => {
  for (const edit of Object.values(edits.rows)) {
    if (edit.displayName !== undefined) {
      const invalid = validateDraftInput(edit.displayName, []);

      if (invalid) {
        return invalid;
      }
    }
  }

  return edits.definitions ? validateDraftInput('-', edits.definitions) : null;
};
