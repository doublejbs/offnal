import { BillingMode } from '@/domain/enums/BillingMode';

/** Beta free mode: no payment, trial or price anywhere (Spec §20). Pure, so client-safe callers may use it. */
export const isBetaFree = (config: { billingMode: BillingMode }): boolean =>
  config.billingMode === BillingMode.BETA_FREE;
