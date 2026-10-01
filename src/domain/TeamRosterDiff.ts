import { type ShiftCodeEntry } from '@/domain/types/ShiftCodeEntry';
import { type TeamCellChange } from '@/domain/types/api/TeamCellChange';

export type DiffRow = {
  rowKey: string;
  excluded: boolean;
  entries: ShiftCodeEntry[];
};

export type RosterCellChange = TeamCellChange & {
  rowKey: string;
};

export type RevisionCellChange = TeamCellChange & {
  revision: number;
};

const toCodeByDate = (entries: ShiftCodeEntry[]): Map<string, string | null> =>
  new Map(entries.map((entry) => [entry.date, entry.code]));

/**
 * Cell changes from the previous published revision to the next one (Team spec §3.3). Only people in both
 * revisions (same row key, not excluded) are compared: a new or removed person is not a "changed date".
 * Output follows the next revision's row order, then date order.
 */
export const diffRosterRows = (previous: DiffRow[], next: DiffRow[]): RosterCellChange[] => {
  const previousByKey = new Map(previous.filter((row) => !row.excluded).map((row) => [row.rowKey, row]));
  const changes: RosterCellChange[] = [];

  for (const row of next) {
    const before = previousByKey.get(row.rowKey);

    if (row.excluded || !before) {
      continue;
    }

    const beforeCodes = toCodeByDate(before.entries);
    const afterCodes = toCodeByDate(row.entries);
    const dates = [...new Set([...beforeCodes.keys(), ...afterCodes.keys()])].sort();

    for (const date of dates) {
      const fromCode = beforeCodes.get(date) ?? null;
      const toCode = afterCodes.get(date) ?? null;

      if (fromCode !== toCode) {
        changes.push({ rowKey: row.rowKey, date, fromCode, toCode });
      }
    }
  }

  return changes;
};

/**
 * Collapses the changes of several unacknowledged revisions into one per date: the code before the first
 * change and after the last one. Dates that changed back to their original code are dropped.
 */
export const collapseRevisionChanges = (changes: RevisionCellChange[]): TeamCellChange[] => {
  const byDate = new Map<string, TeamCellChange>();
  const ordered = [...changes].sort((left, right) => left.revision - right.revision);

  for (const change of ordered) {
    const existing = byDate.get(change.date);

    byDate.set(change.date, {
      date: change.date,
      fromCode: existing ? existing.fromCode : change.fromCode,
      toCode: change.toCode,
    });
  }

  return [...byDate.values()]
    .filter((change) => change.fromCode !== change.toCode)
    .sort((left, right) => left.date.localeCompare(right.date));
};
