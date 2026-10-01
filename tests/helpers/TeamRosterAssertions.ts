/**
 * Assertion and verification helpers for roster test flows.
 */

import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';

/**
 * Fails the test with a clear message instead of a non-null assertion.
 */
export const requireValue = <T>(value: T | null | undefined, label: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`missing ${label}`);
  }

  return value;
};

/**
 * Finds a row by display name and ordinal in a roster response.
 */
export const findRowKey = (roster: TeamRosterResponse, displayName: string, ordinal = 1): string => {
  const row = roster.rows.find(
    (item) => item.displayName === displayName && item.sameNameOrdinal === ordinal,
  );

  if (!row) {
    throw new Error(`row not found: ${displayName} (${ordinal})`);
  }

  return row.rowKey;
};
