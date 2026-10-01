/** Where a month of the member's calendar comes from. */
export enum CalendarMonthSource {
  /** The user's own published month (personal plan, editable). */
  PERSONAL = 'personal',
  /** The latest published team roster row linked to the user (read-only, takes precedence). */
  TEAM = 'team',
}
