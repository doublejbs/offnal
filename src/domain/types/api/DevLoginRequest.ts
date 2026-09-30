/** POST /auth/dev-login body (JSON or form). Demo mode only. */
export type DevLoginRequest = {
  displayName?: string;
  /** Relative path starting with a single '/'. Defaults to '/'. */
  returnTo?: string;
};
