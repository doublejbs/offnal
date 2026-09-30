/** Toss webhook event types handled by the server. */
export enum PaymentWebhookEventType {
  PAYMENT_STATUS_CHANGED = 'PAYMENT_STATUS_CHANGED',
  /** Virtual account deposit (top-level fields, no paymentKey). */
  DEPOSIT_CALLBACK = 'DEPOSIT_CALLBACK',
}
