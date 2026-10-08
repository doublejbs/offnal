import { BillingMode } from '@/domain/enums/BillingMode';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { type EntitlementDecisionInput } from '@/domain/types/EntitlementDecisionInput';

export const decideMonthAccess = (input: EntitlementDecisionInput): MonthAccess => {
  if (input.hasEntitlementForMonth) {
    return MonthAccess.EXISTING;
  }

  if (input.billingMode === BillingMode.BETA_FREE) {
    return MonthAccess.BETA_FREE;
  }

  if (input.trialUsedCount < input.freeMonthLimit) {
    return MonthAccess.TRIAL_AVAILABLE;
  }

  return MonthAccess.PAYMENT_REQUIRED;
};

export const getFreeRemaining = (trialUsedCount: number, freeMonthLimit: number): number =>
  Math.max(0, freeMonthLimit - trialUsedCount);
