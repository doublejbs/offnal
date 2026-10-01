/** How the "일정 파일 받기" button delivers the ICS file on the current browser. */
export enum IcsOpenMethod {
  /** In-app browsers cannot import calendars: show how to reopen in a regular browser. */
  IN_APP_NOTICE = 'in-app-notice',
  /** iOS: top-level navigation to an inline text/calendar response opens the import sheet. */
  NAVIGATE = 'navigate',
  /** Android and desktop: fetch + blob download. */
  DOWNLOAD = 'download',
}
