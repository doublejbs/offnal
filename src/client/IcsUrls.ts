/** Query of every ICS export: `includeOff`, plus `open=1` for an inline response (iOS, Spec §19). */
const buildIcsQuery = (includeOff: boolean, open: boolean): string =>
  `includeOff=${includeOff ? 1 : 0}${open ? '&open=1' : ''}`;

export const buildIcsUrl = (yearMonth: string, includeOff: boolean, open = false): string =>
  `/api/calendar/${encodeURIComponent(yearMonth)}/export.ics?${buildIcsQuery(includeOff, open)}`;

export const buildSharedIcsUrl = (
  token: string,
  yearMonth: string,
  includeOff: boolean,
  open = false,
): string =>
  `/api/shared/${encodeURIComponent(token)}/export.ics?month=${encodeURIComponent(yearMonth)}&${buildIcsQuery(includeOff, open)}`;
