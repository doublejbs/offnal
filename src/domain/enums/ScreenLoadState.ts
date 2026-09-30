/** Common loading outcome of a client screen. */
export enum ScreenLoadState {
  LOADING = 'loading',
  READY = 'ready',
  AUTH_REQUIRED = 'auth_required',
  NOT_FOUND = 'not_found',
  EXPIRED = 'expired',
  ERROR = 'error',
}
