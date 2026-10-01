/** POST /api/calendar/share — enables sharing and sets what the link shows. */
export type UpdateShareRequest = {
  displayName: string;
  /** Months (YYYY-MM) visible through the link: any of `availableMonths` (personal or team). */
  visibleMonths: string[];
};
