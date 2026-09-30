/** `details.reason` of a 409 REVISION_CONFLICT. */
export enum RevisionConflictReason {
  /** The request's draft revision is older than the stored draft. */
  STALE_REVISION = 'stale_revision',
  /** An edit draft was copied from an older published revision than the current one. */
  STALE_BASE = 'stale_base',
}
