export enum MonthAccess {
  EXISTING = 'existing',
  TRIAL_AVAILABLE = 'trial_available',
  PAYMENT_REQUIRED = 'payment_required',
  /** Display-only (never stored): beta free mode opens every month without payment. */
  BETA_FREE = 'beta_free',
}
