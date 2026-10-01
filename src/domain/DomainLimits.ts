/** Shared time units and input limits (single source for server and UI). */
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Person / calendar display name. */
export const MAX_DISPLAY_NAME_LENGTH = 40;
/** Shift definition label. */
export const MAX_LABEL_LENGTH = 20;

/** People in one team roster (pass-1 candidates beyond it are ignored, PATCH cannot add more). */
export const MAX_ROSTER_ROWS = 80;
/** Default lifetime of a team invite link. */
export const DEFAULT_INVITE_DAYS = 14;
/** Attempts per team roster row, like recognition jobs (Team spec §6: "최대 3회"). */
export const MAX_ROW_ATTEMPTS = 3;
/** Extra lease time beyond the provider timeout so a slow finish is not taken over mid-write. */
export const LEASE_GRACE_MS = 30_000;
