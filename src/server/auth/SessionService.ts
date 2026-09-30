import { and, eq, gt } from 'drizzle-orm';

import { MS_PER_DAY } from '@/domain/DomainLimits';
import { getAppConfig } from '@/server/config/AppConfig';
import { generateToken, hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type DbExecutor } from '@/server/db/Database';
import { anonymousSessions, sessions, type UserRow, users } from '@/server/db/Schema';

const SESSION_TTL_DAYS = 30;
const ANONYMOUS_TTL_DAYS = 7;

export type IssuedToken = {
  /** Raw cookie value. Never stored. */
  token: string;
  /** sha256(token) hex, the DB primary key. */
  id: string;
  expiresAt: Date;
};

const issueToken = (ttlDays: number, now: Date): IssuedToken => {
  const token = generateToken();

  return { token, id: hashSha256Hex(token), expiresAt: new Date(now.getTime() + ttlDays * MS_PER_DAY) };
};

export const createUserSession = async (
  db: DbExecutor,
  userId: string,
  now = new Date(),
): Promise<IssuedToken> => {
  const issued = issueToken(SESSION_TTL_DAYS, now);

  await db.insert(sessions).values({ id: issued.id, userId, createdAt: now, expiresAt: issued.expiresAt });

  return issued;
};

export const resolveUserFromSessionToken = async (
  db: DbExecutor,
  token: string,
  now = new Date(),
): Promise<UserRow | null> => {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashSha256Hex(token)), gt(sessions.expiresAt, now)))
    .limit(1);

  return row?.user ?? null;
};

export const destroySessionToken = async (db: DbExecutor, token: string): Promise<void> => {
  await db.delete(sessions).where(eq(sessions.id, hashSha256Hex(token)));
};

export const createAnonymousSession = async (
  db: DbExecutor,
  ipHash: string,
  now = new Date(),
): Promise<IssuedToken> => {
  const issued = issueToken(ANONYMOUS_TTL_DAYS, now);

  await db
    .insert(anonymousSessions)
    .values({ id: issued.id, ipHash, createdAt: now, expiresAt: issued.expiresAt });

  return issued;
};

/** Returns the anonymous session ID (sha256 of the cookie) when it exists and is unexpired. */
export const resolveAnonymousSessionId = async (
  db: DbExecutor,
  token: string,
  now = new Date(),
): Promise<string | null> => {
  const id = hashSha256Hex(token);
  const [row] = await db
    .select({ id: anonymousSessions.id })
    .from(anonymousSessions)
    .where(and(eq(anonymousSessions.id, id), gt(anonymousSessions.expiresAt, now)))
    .limit(1);

  return row?.id ?? null;
};

/** Keyed IP hash so raw IPs are never stored. */
export const hashIp = (ip: string): string => hashSha256Hex(`${getAppConfig().appSecret}:ip:${ip}`);
