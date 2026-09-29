import { and, eq, sql } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RateLimitScope } from '@/domain/enums/RateLimitScope';
import { RateLimitWindow } from '@/domain/enums/RateLimitWindow';
import { getZonedParts, SEOUL_TIMEZONE, zonedWallTimeToUtc } from '@/domain/TimeZone';
import { getAppConfig } from '@/server/config/AppConfig';
import { hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type DbExecutor } from '@/server/db/Database';
import { rateLimitCounters } from '@/server/db/Schema';
import { ApiError } from '@/server/errors/ApiError';

export type RateLimitRule = {
  scope: RateLimitScope;
  /** Raw subject (session ID, IP hash, user ID); hashed with APP_SECRET before storage. */
  subject: string;
  window: RateLimitWindow;
  limit: number;
};

/** Start of the fixed window containing `now`, aligned to Asia/Seoul midnight / first of month. */
export const getWindowStart = (window: RateLimitWindow, now: Date): Date => {
  const parts = getZonedParts(now, SEOUL_TIMEZONE);
  const day = window === RateLimitWindow.DAILY ? parts.day : 1;

  return zonedWallTimeToUtc(
    { year: parts.year, month: parts.month, day, hour: 0, minute: 0 },
    SEOUL_TIMEZONE,
  );
};

export const buildRateLimitKey = (rule: RateLimitRule): string =>
  `${rule.scope}:${rule.window}:${hashSha256Hex(`${getAppConfig().appSecret}:rl:${rule.subject}`)}`;

/** Atomically increments the counter (`count = count + 1`) and returns the new count. */
export const incrementCounter = async (
  db: DbExecutor,
  rule: RateLimitRule,
  now = new Date(),
): Promise<number> => {
  const [row] = await db
    .insert(rateLimitCounters)
    .values({ key: buildRateLimitKey(rule), windowStart: getWindowStart(rule.window, now), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.key, rateLimitCounters.windowStart],
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });

  return row?.count ?? Number.POSITIVE_INFINITY;
};

const readCounter = async (db: DbExecutor, rule: RateLimitRule, now: Date): Promise<number> => {
  const [row] = await db
    .select({ count: rateLimitCounters.count })
    .from(rateLimitCounters)
    .where(
      and(
        eq(rateLimitCounters.key, buildRateLimitKey(rule)),
        eq(rateLimitCounters.windowStart, getWindowStart(rule.window, now)),
      ),
    );

  return row?.count ?? 0;
};

/** Counts one request against every rule; throws 429 when any limit is exceeded. */
export const enforceRateLimits = async (
  db: DbExecutor,
  rules: RateLimitRule[],
  now = new Date(),
): Promise<void> => {
  let exceeded = false;

  for (const rule of rules) {
    if ((await incrementCounter(db, rule, now)) > rule.limit) {
      exceeded = true;
    }
  }

  if (exceeded) {
    throw new ApiError(ApiErrorCode.RATE_LIMITED);
  }
};

/** Read-only pre-check (no increment): throws 429 when the next request would exceed a limit. */
export const assertBelowRateLimits = async (
  db: DbExecutor,
  rules: RateLimitRule[],
  now = new Date(),
): Promise<void> => {
  for (const rule of rules) {
    if ((await readCounter(db, rule, now)) >= rule.limit) {
      throw new ApiError(ApiErrorCode.RATE_LIMITED);
    }
  }
};

export type UploadRateSubject = {
  userId: string | null;
  /** Existing anonymous session; a brand-new session is counted via `countNewAnonymousUpload`. */
  anonymousSessionId: string | null;
  ipHash: string;
};

const buildAnonymousUploadRule = (anonymousSessionId: string): RateLimitRule => ({
  scope: RateLimitScope.UPLOAD_ANONYMOUS,
  subject: anonymousSessionId,
  window: RateLimitWindow.DAILY,
  limit: getAppConfig().rateLimitAnonDaily,
});

/** Counts the upload attempt (valid or not) per IP and per user or existing anonymous session. */
export const enforceUploadLimits = async (db: DbExecutor, subject: UploadRateSubject): Promise<void> => {
  const config = getAppConfig();
  const rules: RateLimitRule[] = [
    {
      scope: RateLimitScope.UPLOAD_IP,
      subject: subject.ipHash,
      window: RateLimitWindow.DAILY,
      limit: config.rateLimitIpDaily,
    },
  ];

  if (subject.userId) {
    rules.push({
      scope: RateLimitScope.UPLOAD_USER,
      subject: subject.userId,
      window: RateLimitWindow.DAILY,
      limit: config.rateLimitUserDaily,
    });
  } else if (subject.anonymousSessionId) {
    rules.push(buildAnonymousUploadRule(subject.anonymousSessionId));
  }

  await enforceRateLimits(db, rules);
};

/** First upload of a session created in the same request. */
export const countNewAnonymousUpload = async (db: DbExecutor, anonymousSessionId: string): Promise<void> => {
  await enforceRateLimits(db, [buildAnonymousUploadRule(anonymousSessionId)]);
};

const buildExtractRule = (userId: string): RateLimitRule => ({
  scope: RateLimitScope.EXTRACT_USER,
  subject: userId,
  window: RateLimitWindow.MONTHLY,
  limit: getAppConfig().extractLimitUserMonthly,
});

/** Before the provider call: refuse when the monthly extract limit is already used up (no charge). */
export const assertExtractAllowed = async (db: DbExecutor, userId: string): Promise<void> => {
  await assertBelowRateLimits(db, [buildExtractRule(userId)]);
};

/** Charges one extract; called once per created draft. */
export const chargeExtract = async (db: DbExecutor, userId: string): Promise<void> => {
  await enforceRateLimits(db, [buildExtractRule(userId)]);
};

/** Public share link views per IP hash (GET /api/shared/:token). */
export const enforceSharedViewLimit = async (db: DbExecutor, ipHash: string): Promise<void> => {
  await enforceRateLimits(db, [
    {
      scope: RateLimitScope.SHARED_VIEW_IP,
      subject: ipHash,
      window: RateLimitWindow.DAILY,
      limit: getAppConfig().rateLimitSharedIpDaily,
    },
  ]);
};

/** Payment webhook deliveries per IP hash. */
export const enforceWebhookLimit = async (db: DbExecutor, ipHash: string): Promise<void> => {
  await enforceRateLimits(db, [
    {
      scope: RateLimitScope.PAYMENT_WEBHOOK_IP,
      subject: ipHash,
      window: RateLimitWindow.DAILY,
      limit: getAppConfig().rateLimitWebhookIpDaily,
    },
  ]);
};
