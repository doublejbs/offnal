import { describe, expect, it } from 'vitest';

import { MonthAccess } from '@/domain/enums/MonthAccess';
import { decideMonthAccess, getFreeRemaining } from '@/domain/EntitlementPolicy';

describe('EntitlementPolicy', () => {
  it('uses the existing entitlement first', () => {
    expect(decideMonthAccess({ hasEntitlementForMonth: true, trialUsedCount: 5, freeMonthLimit: 2 })).toBe(
      MonthAccess.EXISTING,
    );
  });

  it('allows a trial while under the free limit', () => {
    expect(decideMonthAccess({ hasEntitlementForMonth: false, trialUsedCount: 0, freeMonthLimit: 2 })).toBe(
      MonthAccess.TRIAL_AVAILABLE,
    );
    expect(decideMonthAccess({ hasEntitlementForMonth: false, trialUsedCount: 1, freeMonthLimit: 2 })).toBe(
      MonthAccess.TRIAL_AVAILABLE,
    );
  });

  it('requires payment for the third unique month', () => {
    expect(decideMonthAccess({ hasEntitlementForMonth: false, trialUsedCount: 2, freeMonthLimit: 2 })).toBe(
      MonthAccess.PAYMENT_REQUIRED,
    );
    expect(decideMonthAccess({ hasEntitlementForMonth: false, trialUsedCount: 0, freeMonthLimit: 0 })).toBe(
      MonthAccess.PAYMENT_REQUIRED,
    );
  });

  it('computes free months remaining', () => {
    expect(getFreeRemaining(0, 2)).toBe(2);
    expect(getFreeRemaining(1, 2)).toBe(1);
    expect(getFreeRemaining(3, 2)).toBe(0);
  });
});
