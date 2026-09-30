/** POST /api/payments */
export type CreatePaymentRequest = {
  /** YYYY-MM */
  yearMonth: string;
  /** Draft to publish after the payment succeeds (carried through the provider redirect). */
  draftId?: string;
};
