import { sql } from 'drizzle-orm';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { RateLimitWindow } from '@/domain/enums/RateLimitWindow';
import { getZonedParts, SEOUL_TIMEZONE, zonedWallTimeToUtc } from '@/domain/TimeZone';
import { getAppConfig } from '@/server/config/AppConfig';
import { hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type DbExecutor } from '@/server/db/Database';
import { rateLimitCounters } from '@/server/db/Schema';
import { ApiError } from '@/server/http/ApiError';

const UPLOAD_ANONYMOUS_SCOPE = 'upload:anon';
const UPLOAD_IP_SCOPE = 'upload:ip';
const UPLOAD_USER_SCOPE = 'upload:user';
const EXTRACT_USER_SCOPE = 'extract:user';

export type RateLimitRule = {
  scope: string;
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

const buildKey = (rule: RateLimitRule): string =>
  `${rule.scope}:${rule.window}:${hashSha256Hex(`${getAppConfig().appSecret}:rl:${rule.subject}`)}`;

/** Atomically increments the counter and returns the new count. */
export const incrementCounter = async (
  db: DbExecutor,
  rule: RateLimitRule,
  now = new Date(),
): Promise<number> => {
  const [row] = await db
    .insert(rateLimitCounters)
    .values({ key: buildKey(rule), windowStart: getWindowStart(rule.window, now), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.key, rateLimitCounters.windowStart],
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });

  return row?.count ?? Number.POSITIVE_INFINITY;
};

/** Counts one request against every rule; throws 429 when any limit is exceeded. */
export const enforceRateLimits = async (
  db: DbExecutor,
  rules: RateLimitRule[],
  now = new Date(),
): Promise<void> => {
  let exceeded = false;

  for (const rule of rules) {
    const count = await incrementCounter(db, rule, now);

    if (count > rule.limit) {
      exceeded = true;
    }
  }

  if (exceeded) {
    throw new ApiError(ApiErrorCode.RATE_LIMITED);
  }
};

export type UploadRateSubject = {
  userId: string | null;
  anonymousSessionId: string | null;
  ipHash: string;
};

export const enforceUploadLimits = async (db: DbExecutor, subject: UploadRateSubject): Promise<void> => {
  const config = getAppConfig();
  const rules: RateLimitRule[] = [
    {
      scope: UPLOAD_IP_SCOPE,
      subject: subject.ipHash,
      window: RateLimitWindow.DAILY,
      limit: config.rateLimitIpDaily,
    },
  ];

  if (subject.userId) {
    rules.push({
      scope: UPLOAD_USER_SCOPE,
      subject: subject.userId,
      window: RateLimitWindow.DAILY,
      limit: config.rateLimitUserDaily,
    });
  } else if (subject.anonymousSessionId) {
    rules.push({
      scope: UPLOAD_ANONYMOUS_SCOPE,
      subject: subject.anonymousSessionId,
      window: RateLimitWindow.DAILY,
      limit: config.rateLimitAnonDaily,
    });
  }

  await enforceRateLimits(db, rules);
};

export const enforceExtractLimit = async (db: DbExecutor, userId: string): Promise<void> => {
  await enforceRateLimits(db, [
    {
      scope: EXTRACT_USER_SCOPE,
      subject: userId,
      window: RateLimitWindow.MONTHLY,
      limit: getAppConfig().extractLimitUserMonthly,
    },
  ]);
};
