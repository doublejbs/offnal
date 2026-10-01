'use client';

import { useState } from 'react';

import { getErrorMessage, isApiClientError } from '@/client/ApiClient';
import {
  addDefinition,
  applyCodeToDate,
  type DefinitionPatch,
  removeDefinition,
  updateDefinition,
} from '@/client/DraftEditing';
import { type RosterAutosave } from '@/components/roster/UseRosterAutosave';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { isValidYearMonth } from '@/domain/YearMonth';

type RosterEditsInput = {
  /** Server copy with unsaved edits applied. */
  view: TeamRosterResponse | null;
  autosave: RosterAutosave;
  /** Publishing or extracting: every edit is ignored. */
  isLocked: boolean;
};

/**
 * Edit handlers of the roster review. Cell, name, exclusion and legend edits are debounced through the
 * autosave queue; row additions, "이름 바뀜" and month changes are immediate PATCHes after pending edits.
 */
export const useRosterEdits = ({ view, autosave, isLocked }: RosterEditsInput) => {
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canEdit = view !== null && !isLocked && !isActionBusy;

  const findRow = (rowId: string) => view?.rows.find((row) => row.id === rowId) ?? null;

  const handleSelectCode = (rowId: string, date: string, code: string | null) => {
    const row = findRow(rowId);

    if (canEdit && row) {
      autosave.edit({ rows: { [rowId]: { entries: applyCodeToDate(row.entries, date, code) } } });
    }
  };

  /** Returns an error message, or null when added (and applied to the cell when one is given). */
  const handleAddCode = (
    code: string,
    label: string,
    cell: { rowId: string; date: string } | null,
  ): string | null => {
    if (!canEdit || !view) {
      return null;
    }

    const result = addDefinition(view.definitions, code, label);
    const added = result.definitions.at(-1);
    const row = cell ? findRow(cell.rowId) : null;

    if (result.error) {
      return result.error;
    }

    autosave.edit({
      definitions: result.definitions,
      rows:
        cell && row && added
          ? { [cell.rowId]: { entries: applyCodeToDate(row.entries, cell.date, added.code) } }
          : {},
    });

    return null;
  };

  const handleUpdateDefinition = (code: string, patch: DefinitionPatch) => {
    if (canEdit && view) {
      autosave.edit({ definitions: updateDefinition(view.definitions, code, patch), rows: {} });
    }
  };

  const handleRemoveDefinition = (code: string) => {
    const remaining = view
      ? removeDefinition(
          view.definitions,
          view.rows.flatMap((row) => row.entries),
          code,
        )
      : null;

    if (canEdit && remaining) {
      autosave.edit({ definitions: remaining, rows: {} });
    }
  };

  const handleRename = (rowId: string, displayName: string) => {
    if (canEdit) {
      autosave.edit({ rows: { [rowId]: { displayName } } });
    }
  };

  const handleToggleExcluded = (rowId: string, excluded: boolean) => {
    if (canEdit) {
      autosave.edit({ rows: { [rowId]: { excluded } } });
    }
  };

  /** Immediate PATCH; conflicts are reported by the autosave status (it reloads the roster). */
  const runNow = async (body: Omit<PatchTeamRosterRequest, 'version'>): Promise<boolean> => {
    if (!canEdit) {
      return false;
    }

    setIsActionBusy(true);
    setActionError(null);

    try {
      await autosave.run(body);

      return true;
    } catch (caught: unknown) {
      if (!(isApiClientError(caught) && caught.code === ApiErrorCode.REVISION_CONFLICT)) {
        setActionError(getErrorMessage(caught));
      }

      return false;
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleAddRow = (displayName: string): Promise<boolean> =>
    runNow({ addRows: [{ displayName: displayName.trim() }] });

  const handleMatchRow = (rowId: string, matchRowKey: string): Promise<boolean> =>
    runNow({ rows: [{ rowId, matchRowKey }] });

  const handleChangeMonth = async (yearMonth: string): Promise<boolean> =>
    isValidYearMonth(yearMonth) && yearMonth !== view?.roster.yearMonth ? runNow({ yearMonth }) : false;

  return {
    canEdit,
    isActionBusy,
    actionError,
    handleSelectCode,
    handleAddCode,
    handleUpdateDefinition,
    handleRemoveDefinition,
    handleRename,
    handleToggleExcluded,
    handleAddRow,
    handleMatchRow,
    handleChangeMonth,
  };
};

export type RosterEditHandlers = ReturnType<typeof useRosterEdits>;
