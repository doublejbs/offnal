/** POST /api/payments/confirm — values returned by the provider redirect. */
export type ConfirmPaymentRequest = {
  orderId: string;
  paymentKey: string;
  amount: number;
};
