/** Checkout result screen stage (after the payment provider redirect). */
export enum CheckoutResultStage {
  CONFIRMING = 'confirming',
  PUBLISHING = 'publishing',
  PAYMENT_FAILED = 'payment_failed',
  CONFIRM_FAILED = 'confirm_failed',
  PUBLISH_FAILED = 'publish_failed',
  DONE = 'done',
}
