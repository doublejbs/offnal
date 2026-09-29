import { and, eq, gt } from 'drizzle-orm';
import { type NextResponse } from 'next/server';

import { getAppConfig } from '@/server/config/AppConfig';
import { generateToken, hashSha256Hex } from '@/server/crypto/TokenCrypto';
import { type DbExecutor } from '@/server/db/Database';
import { anonymousSessions, sessions, type UserRow, users } from '@/server/db/Schema';

export const SESSION_COOKIE_NAME = 'offnal_session';
export const ANONYMOUS_COOKIE_NAME = 'offnal_anon';

const MS_PER_DAY = 86_400_000;
const SESSION_TTL_DAYS = 30;
const ANONYMOUS_TTL_DAYS = 7;

export type IssuedToken = {
  /** Raw cookie value. Never stored. */
  token: string;
  /** sha256(token) hex, the DB primary key. */
  id: string;
  expiresAt: Date;
};

export type CookieOptions = {
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  expires: Date;
};

const issueToken = (ttlDays: number, now: Date): IssuedToken => {
  const token = generateToken();

  return { token, id: hashSha256Hex(token), expiresAt: new Date(now.getTime() + ttlDays * MS_PER_DAY) };
};

export const isSecureAppUrl = (): boolean => getAppConfig().appUrl.startsWith('https://');

export const buildCookieOptions = (expiresAt: Date): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: isSecureAppUrl(),
  expires: expiresAt,
});

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

export const setSessionCookie = (response: NextResponse, issued: IssuedToken): void => {
  response.cookies.set(SESSION_COOKIE_NAME, issued.token, buildCookieOptions(issued.expiresAt));
};

export const clearSessionCookie = (response: NextResponse): void => {
  response.cookies.set(SESSION_COOKIE_NAME, '', { ...buildCookieOptions(new Date(0)), maxAge: 0 });
};

export const setAnonymousCookie = (response: NextResponse, issued: IssuedToken): void => {
  response.cookies.set(ANONYMOUS_COOKIE_NAME, issued.token, buildCookieOptions(issued.expiresAt));
};

/** Keyed IP hash so raw IPs are never stored. */
export const hashIp = (ip: string): string => hashSha256Hex(`${getAppConfig().appSecret}:ip:${ip}`);
