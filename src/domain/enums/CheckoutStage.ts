/** Month checkout screen stage. */
export enum CheckoutStage {
  IDLE = 'idle',
  CREATING = 'creating',
  MOCK_READY = 'mock_ready',
  TOSS_LOADING = 'toss_loading',
  TOSS_READY = 'toss_ready',
  REQUESTING = 'requesting',
  ALREADY_ENTITLED = 'already_entitled',
  ERROR = 'error',
}
