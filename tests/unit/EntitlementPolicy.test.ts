import { describe, expect, it } from 'vitest';

import { BillingMode } from '@/domain/enums/BillingMode';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { decideMonthAccess, getFreeRemaining } from '@/domain/EntitlementPolicy';

describe('EntitlementPolicy', () => {
  it('uses the existing entitlement first', () => {
    expect(
      decideMonthAccess({
        billingMode: BillingMode.PAID,
        hasEntitlementForMonth: true,
        trialUsedCount: 5,
        freeMonthLimit: 2,
      }),
    ).toBe(MonthAccess.EXISTING);
  });

  it('allows a trial while under the free limit', () => {
    expect(
      decideMonthAccess({
        billingMode: BillingMode.PAID,
        hasEntitlementForMonth: false,
        trialUsedCount: 0,
        freeMonthLimit: 2,
      }),
    ).toBe(MonthAccess.TRIAL_AVAILABLE);
    expect(
      decideMonthAccess({
        billingMode: BillingMode.PAID,
        hasEntitlementForMonth: false,
        trialUsedCount: 1,
        freeMonthLimit: 2,
      }),
    ).toBe(MonthAccess.TRIAL_AVAILABLE);
  });

  it('requires payment for the third unique month', () => {
    expect(
      decideMonthAccess({
        billingMode: BillingMode.PAID,
        hasEntitlementForMonth: false,
        trialUsedCount: 2,
        freeMonthLimit: 2,
      }),
    ).toBe(MonthAccess.PAYMENT_REQUIRED);
    expect(
      decideMonthAccess({
        billingMode: BillingMode.PAID,
        hasEntitlementForMonth: false,
        trialUsedCount: 0,
        freeMonthLimit: 0,
      }),
    ).toBe(MonthAccess.PAYMENT_REQUIRED);
  });

  it('keeps the existing entitlement first in beta_free', () => {
    expect(
      decideMonthAccess({
        billingMode: BillingMode.BETA_FREE,
        hasEntitlementForMonth: true,
        trialUsedCount: 0,
        freeMonthLimit: 2,
      }),
    ).toBe(MonthAccess.EXISTING);
  });

  it('opens every month without an entitlement in beta_free, ignoring trial and limit', () => {
    const cases: Array<[number, number]> = [
      [0, 2],
      [2, 2],
      [5, 2],
      [0, 0],
    ];

    for (const [trialUsedCount, freeMonthLimit] of cases) {
      expect(
        decideMonthAccess({
          billingMode: BillingMode.BETA_FREE,
          hasEntitlementForMonth: false,
          trialUsedCount,
          freeMonthLimit,
        }),
      ).toBe(MonthAccess.BETA_FREE);
    }
  });

  it('computes free months remaining', () => {
    expect(getFreeRemaining(0, 2)).toBe(2);
    expect(getFreeRemaining(1, 2)).toBe(1);
    expect(getFreeRemaining(3, 2)).toBe(0);
  });
});
