import { and, count, eq } from 'drizzle-orm';

import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { decideMonthAccess, getFreeRemaining } from '@/domain/EntitlementPolicy';
import { type MonthAccessInfo } from '@/domain/types/api/MonthAccessInfo';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';
import { type DbExecutor } from '@/server/db/Database';
import { type EntitlementRow, entitlements } from '@/server/db/Schema';

/** Entitlement for one month (trial or purchase), or null. Used by publish, ICS/PNG export and payments. */
export const findEntitlement = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<EntitlementRow | null> => {
  const [row] = await db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.yearMonth, yearMonth)))
    .limit(1);

  return row ?? null;
};

export const hasEntitlement = async (db: DbExecutor, userId: string, yearMonth: string): Promise<boolean> =>
  (await findEntitlement(db, userId, yearMonth)) !== null;

export const countTrialEntitlements = async (db: DbExecutor, userId: string): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.source, EntitlementSource.TRIAL)));

  return row?.value ?? 0;
};

export const getFreeRemainingForUser = async (db: DbExecutor, userId: string): Promise<number> =>
  getFreeRemaining(await countTrialEntitlements(db, userId), getAppConfig().freeMonthLimit);

/** Display-only access decision; the authoritative check runs inside the publish transaction. */
export const getMonthAccessInfo = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<MonthAccessInfo> => {
  const pricing = getPricing(getAppConfig());
  const trialUsedCount = await countTrialEntitlements(db, userId);
  const monthAccess = decideMonthAccess({
    hasEntitlementForMonth: await hasEntitlement(db, userId, yearMonth),
    trialUsedCount,
    freeMonthLimit: pricing.freeMonthLimit,
  });

  return {
    monthAccess,
    freeRemaining: getFreeRemaining(trialUsedCount, pricing.freeMonthLimit),
    priceKrw: pricing.priceKrw,
  };
};

export const insertTrialEntitlement = async (
  db: DbExecutor,
  userId: string,
  yearMonth: string,
): Promise<void> => {
  await db.insert(entitlements).values({ userId, yearMonth, source: EntitlementSource.TRIAL });
};
