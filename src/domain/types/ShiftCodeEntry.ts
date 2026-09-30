/** A day with its shift code only (no review data): what share views, ICS and PNG need. */
export type ShiftCodeEntry = {
  /** YYYY-MM-DD */
  date: string;
  code: string | null;
};
