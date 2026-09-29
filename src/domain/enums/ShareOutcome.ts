/** Result of handing a file or link to the OS share sheet, the clipboard or a download. */
export enum ShareOutcome {
  SHARED = 'shared',
  DOWNLOADED = 'downloaded',
  COPIED = 'copied',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}
