/** GET/POST /api/calendar/share, POST /api/calendar/share/rotate, DELETE /api/calendar/share */
export type ShareSettingsResponse = {
  enabled: boolean;
  /** Absolute share URL (`${APP_URL}/s/${token}`); null when sharing is off. */
  url: string | null;
  displayName: string;
  visibleMonths: string[];
  /** All published months of the owner, ascending. */
  availableMonths: string[];
};
