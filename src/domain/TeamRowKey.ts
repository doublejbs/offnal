import { normalizePersonName } from '@/domain/PersonName';

/** Separates the normalized name from the same-name ordinal; never part of a normalized name. */
const ROW_KEY_SEPARATOR = '#';

export type RowKeyAssignment = {
  rowKey: string;
  /** 1-based position among rows with the same normalized name, in the given order. */
  sameNameOrdinal: number;
};

/** Person key inside a team month (Team spec §5): normalized name + same-name ordinal, e.g. `김하루#2`. */
export const buildRowKey = (name: string, sameNameOrdinal: number): string =>
  `${normalizePersonName(name)}${ROW_KEY_SEPARATOR}${sameNameOrdinal}`;

/** Row keys for names in table order: the n-th row with the same normalized name gets ordinal n. */
export const assignRowKeys = (names: string[]): RowKeyAssignment[] => {
  const seen = new Map<string, number>();

  return names.map((name) => {
    const normalized = normalizePersonName(name);
    const sameNameOrdinal = (seen.get(normalized) ?? 0) + 1;

    seen.set(normalized, sameNameOrdinal);

    return { rowKey: buildRowKey(name, sameNameOrdinal), sameNameOrdinal };
  });
};

/** Key for a row added by hand: the first free ordinal for that name among `existingKeys`. */
export const buildNextRowKey = (name: string, existingKeys: Iterable<string>): string => {
  const taken = new Set(existingKeys);
  let ordinal = 1;

  while (taken.has(buildRowKey(name, ordinal))) {
    ordinal += 1;
  }

  return buildRowKey(name, ordinal);
};

/** 1-based ordinal and count of each row among rows sharing its normalized display name (input order). */
export const computeSameNameLabels = (
  names: string[],
): { sameNameOrdinal: number; sameNameCount: number }[] => {
  const counts = new Map<string, number>();

  for (const name of names) {
    const normalized = normalizePersonName(name);

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return assignRowKeys(names).map((assignment, index) => ({
    sameNameOrdinal: assignment.sameNameOrdinal,
    sameNameCount: counts.get(normalizePersonName(names[index] ?? '')) ?? 1,
  }));
};

export type RowKeyMatch = {
  /** Keys present in both revisions (the same person). */
  matched: string[];
  /** Keys only in the new revision: a new person, or a renamed one the admin may link (`matchRowKey`). */
  added: string[];
  /** Keys only in the previous revision. */
  missing: string[];
};

/** Matches the rows of a new revision with the previous one by row key (Team spec §5). */
export const matchRowKeys = (previousKeys: string[], nextKeys: string[]): RowKeyMatch => {
  const previous = new Set(previousKeys);
  const next = new Set(nextKeys);

  return {
    matched: nextKeys.filter((key) => previous.has(key)),
    added: nextKeys.filter((key) => !previous.has(key)),
    missing: previousKeys.filter((key) => !next.has(key)),
  };
};
