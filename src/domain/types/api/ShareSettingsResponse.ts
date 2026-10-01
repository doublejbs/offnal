/** GET/POST /api/calendar/share, POST /api/calendar/share/rotate, DELETE /api/calendar/share */
export type ShareSettingsResponse = {
  enabled: boolean;
  /** Absolute share URL (`${APP_URL}/s/${token}`); null when sharing is off. */
  url: string | null;
  displayName: string;
  visibleMonths: string[];
  /** Every month of the owner's calendar (personal and team), ascending. Team months start hidden. */
  availableMonths: string[];
  /** Months of `availableMonths` that are team months (label them with the team name). */
  teamMonths: string[];
};
