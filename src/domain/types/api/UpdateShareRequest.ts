/** POST /api/calendar/share — enables sharing and sets what the link shows. */
export type UpdateShareRequest = {
  displayName: string;
  /** Published months (YYYY-MM) visible through the link. Only the owner's published months are accepted. */
  visibleMonths: string[];
};
