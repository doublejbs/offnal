import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import {
  ANONYMOUS_COOKIE_NAME,
  hashIp,
  resolveAnonymousSessionId,
  resolveUserFromSessionToken,
  SESSION_COOKIE_NAME,
} from '@/server/auth/SessionService';
import { type DbExecutor, getDb } from '@/server/db/Database';
import { type UserRow } from '@/server/db/Schema';
import { ApiError } from '@/server/http/ApiError';
import { getClientIp } from '@/server/http/RouteHelpers';

export type RequestContext = {
  user: UserRow | null;
  /** Raw session cookie value when it resolved to a valid session. */
  sessionToken: string | null;
  /** Anonymous session ID (sha256 of the `offnal_anon` cookie) when valid. */
  anonymousSessionId: string | null;
  ip: string;
  ipHash: string;
};

export type LoggedInContext = RequestContext & { user: UserRow };

type CookieReader = (name: string) => string | undefined;

const resolveContext = async (
  db: DbExecutor,
  readCookie: CookieReader,
  ip: string,
): Promise<RequestContext> => {
  const rawSession = readCookie(SESSION_COOKIE_NAME);
  const rawAnonymous = readCookie(ANONYMOUS_COOKIE_NAME);
  const user = rawSession ? await resolveUserFromSessionToken(db, rawSession) : null;
  const anonymousSessionId = rawAnonymous ? await resolveAnonymousSessionId(db, rawAnonymous) : null;

  return {
    user,
    sessionToken: user ? (rawSession ?? null) : null,
    anonymousSessionId,
    ip,
    ipHash: hashIp(ip),
  };
};

/** API routes: reads cookies from the NextRequest only (never next/headers). */
export const getRequestContext = async (request: NextRequest, db: DbExecutor): Promise<RequestContext> =>
  resolveContext(db, (name) => request.cookies.get(name)?.value, getClientIp(request));

/** Server components: same resolution logic, reading cookies via next/headers. */
export const getServerComponentContext = async (): Promise<RequestContext> => {
  const { cookies, headers } = await import('next/headers');
  const cookieStore = await cookies();
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  return resolveContext(await getDb(), (name) => cookieStore.get(name)?.value, ip);
};

export const requireUser = (context: RequestContext): LoggedInContext => {
  if (!context.user) {
    throw new ApiError(ApiErrorCode.AUTH_REQUIRED);
  }

  return { ...context, user: context.user };
};
