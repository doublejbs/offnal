/** How the roster screen reacts to a failed publish (client decision, see classifyPublishFailure). */
export enum RosterPublishFailureKind {
  /** 422 with `unlinkedRows`: confirm, then resend with `confirmUnlinked`. */
  UNLINKED_ROWS = 'unlinked_rows',
  /** 422 with row blockers: list them. */
  BLOCKED = 'blocked',
  /** 409 STALE_BASE: a newer revision was published after this draft was made. */
  STALE_BASE = 'stale_base',
  /** 409 STALE_REVISION: reload the roster. */
  STALE_VERSION = 'stale_version',
  /** Anything else: show the message. */
  OTHER = 'other',
}
