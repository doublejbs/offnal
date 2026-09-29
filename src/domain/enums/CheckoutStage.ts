/** Month checkout screen stage. */
export enum CheckoutStage {
  /** Creating (or reusing) the pending order on entry. */
  CREATING = 'creating',
  MOCK_READY = 'mock_ready',
  TOSS_LOADING = 'toss_loading',
  TOSS_READY = 'toss_ready',
  REQUESTING = 'requesting',
  /** A free month is still available: nothing to buy, save the draft for free instead. */
  FREE_MONTH_AVAILABLE = 'free_month_available',
  /** The month is already entitled: publishing the draft / returning without payment. */
  ENTITLED = 'entitled',
  AUTH_REQUIRED = 'auth_required',
  ERROR = 'error',
}
