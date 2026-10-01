/** One changed date of a person between two published revisions (codes only). */
export type TeamCellChange = {
  /** YYYY-MM-DD */
  date: string;
  /** Code in the earlier revision (null = empty / not present). */
  fromCode: string | null;
  /** Code in the newer revision (null = empty / not present). */
  toCode: string | null;
};
