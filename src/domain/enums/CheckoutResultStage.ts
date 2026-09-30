/** Checkout result screen stage (after the payment provider redirect). */
export enum CheckoutResultStage {
  CONFIRMING = 'confirming',
  PUBLISHING = 'publishing',
  /** Confirmed but not paid yet (e.g. virtual account waiting for a deposit). */
  PENDING_DEPOSIT = 'pending_deposit',
  PAYMENT_FAILED = 'payment_failed',
  /** The order can no longer be paid (already failed/canceled): start a new checkout. */
  ORDER_CLOSED = 'order_closed',
  /** Confirm did not reach a decision (network / provider delay): retrying confirm is safe. */
  CONFIRM_FAILED = 'confirm_failed',
  PUBLISH_FAILED = 'publish_failed',
  DONE = 'done',
}
