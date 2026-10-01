/** A team month with a published roster (latest revision). */
export type TeamPublishedMonthSummary = {
  /** YYYY-MM */
  yearMonth: string;
  revision: number;
  /** ISO 8601 */
  publishedAt: string;
  /** Roster ID of the published revision; null for non-admins (they read it via /roster/:yearMonth). */
  rosterId: string | null;
};
