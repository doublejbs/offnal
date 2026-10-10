/** Why the OAuth callback failed (`login_failed.kind`, Spec §26.5). A fixed category, never the provider message. */
export enum LoginFailureKind {
  /** The provider returned an error (user cancelled or consent rejected) or no code. */
  CANCELLED = 'cancelled',
  /** Kakao login is not enabled or not configured. */
  UNAVAILABLE = 'unavailable',
  /** Our side failed before the provider was asked (DB, pre-login context). */
  SERVER_ERROR = 'server_error',
  /** The code could not be exchanged for a session. */
  EXCHANGE_FAILED = 'exchange_failed',
  /** The exchange succeeded but linking the app user (or claiming jobs) failed. */
  LINK_FAILED = 'link_failed',
}
