/** Per-person second-pass state of a roster row (Team spec §6, persisted so extraction can resume). */
export enum RosterRowExtractStatus {
  /** Waiting for `extract-next`. */
  PENDING = 'pending',
  /** Claimed by an `extract-next` call (lease); an expired lease makes it claimable again. */
  PROCESSING = 'processing',
  DONE = 'done',
  /** Extraction failed; `extract-next` with `retryFailed` retries it while attempts remain (max 3). */
  FAILED = 'failed',
  /** Added or filled in by an admin (no recognition). */
  MANUAL = 'manual',
}
