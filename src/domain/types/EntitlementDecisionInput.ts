import { type BillingMode } from '@/domain/enums/BillingMode';

export type EntitlementDecisionInput = {
  billingMode: BillingMode;
  hasEntitlementForMonth: boolean;
  trialUsedCount: number;
  freeMonthLimit: number;
};
