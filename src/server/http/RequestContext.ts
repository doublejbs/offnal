import { and, eq } from 'drizzle-orm';
import { type NextRequest } from 'next/server';

import { AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { isKakaoLoginEnabled } from '@/server/auth/AuthProviderRegistry';
import { hashIp, resolveAnonymousSessionId, resolveUserFromSessionToken } from '@/server/auth/SessionService';
import {
  createSupabaseRouteClient,
  createSupabaseServerComponentClient,
  hasSupabaseCookies,
  readVerifiedSupabaseUserId,
  type SupabaseAuthApi,
  type SupabaseCookie,
  type SupabaseRouteClient,
} from '@/server/auth/SupabaseServerClient';
import { isDemoMode } from '@/server/config/AppConfig';
import { type DbExecutor, getDb } from '@/server/db/Database';
import { authIdentities, type UserRow, users } from '@/server/db/Schema';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { ANONYMOUS_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/server/http/SessionCookies';

export type RequestContext = {
  user: UserRow | null;
  /** Raw demo `offnal_session` cookie value when it resolved to a valid session (demo mode only). */
  sessionToken: string | null;
  /** Signature-verified Supabase user ID (`sub`), even when no app user is linked to it yet. */
  supabaseUserId: string | null;
  /** Anonymous session ID (sha256 of the `offnal_anon` cookie) when valid. */
  anonymousSessionId: string | null;
  ip: string;
  ipHash: string;
};

export type LoggedInContext = RequestContext & { user: UserRow };

/** API request context plus the Supabase client whose cookie writes (refreshes) belong on the response. */
export type RequestSession = {
  context: RequestContext;
  supabase: SupabaseRouteClient | null;
};

type CookieSource = {
  read: (name: string) => string | undefined;
  all: () => SupabaseCookie[];
  /** Lazily creates the Supabase client (only when Supabase cookies are present). */
  createSupabase: () => Promise<SupabaseAuthApi | null>;
};

const findUserBySupabaseId = async (db: DbExecutor, supabaseUserId: string): Promise<UserRow | null> => {
  const [row] = await db
    .select({ user: users })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(
        eq(authIdentities.provider, AuthIdentityProvider.SUPABASE),
        eq(authIdentities.providerSubject, supabaseUserId),
      ),
    )
    .limit(1);

  return row?.user ?? null;
};

/**
 * Supabase session first (Kakao enabled + `sb-*` cookies present, so anonymous traffic never calls
 * Supabase): `getClaims()` verifies the JWT signature (locally with asymmetric signing keys) and the
 * `sub` maps to an app user via `auth_identities`. A verified Supabase user without an app row (the
 * callback never completed) counts as logged out: only the callback creates users and claims jobs.
 */
const resolveSupabaseUser = async (
  db: DbExecutor,
  source: CookieSource,
): Promise<{ supabaseUserId: string | null; user: UserRow | null }> => {
  if (!isKakaoLoginEnabled() || !hasSupabaseCookies(source.all())) {
    return { supabaseUserId: null, user: null };
  }

  const auth = await source.createSupabase();
  const supabaseUserId = auth ? await readVerifiedSupabaseUserId(auth) : null;

  return { supabaseUserId, user: supabaseUserId ? await findUserBySupabaseId(db, supabaseUserId) : null };
};

const NO_SUPABASE_USER = { supabaseUserId: null, user: null };

const resolveContext = async (
  db: DbExecutor,
  source: CookieSource,
  ip: string,
  includeSupabase = true,
): Promise<RequestContext> => {
  const rawSession = isDemoMode() ? source.read(SESSION_COOKIE_NAME) : undefined;
  const rawAnonymous = source.read(ANONYMOUS_COOKIE_NAME);
  const supabase = includeSupabase ? await resolveSupabaseUser(db, source) : NO_SUPABASE_USER;
  const demoUser = !supabase.user && rawSession ? await resolveUserFromSessionToken(db, rawSession) : null;
  const anonymousSessionId = rawAnonymous ? await resolveAnonymousSessionId(db, rawAnonymous) : null;

  return {
    user: supabase.user ?? demoUser,
    sessionToken: demoUser ? (rawSession ?? null) : null,
    supabaseUserId: supabase.supabaseUserId,
    anonymousSessionId,
    ip,
    ipHash: hashIp(ip),
  };
};

/** API routes: reads cookies from the NextRequest only (never next/headers). */
export const getRequestSession = async (request: NextRequest, db: DbExecutor): Promise<RequestSession> => {
  let supabase: SupabaseRouteClient | null = null;

  const context = await resolveContext(
    db,
    {
      read: (name) => request.cookies.get(name)?.value,
      all: () => request.cookies.getAll(),
      createSupabase: async () => {
        supabase = createSupabaseRouteClient(request);

        return supabase?.auth ?? null;
      },
    },
    getClientIpFromHeaders(request.headers),
  );

  return { context, supabase };
};

/**
 * Login callback: anonymous session and demo session only. The Supabase session is about to be
 * replaced by the code exchange, so verifying the old one (getClaims) would be wasted work.
 */
export const getPreLoginContext = async (request: NextRequest, db: DbExecutor): Promise<RequestContext> =>
  resolveContext(
    db,
    {
      read: (name) => request.cookies.get(name)?.value,
      all: () => request.cookies.getAll(),
      createSupabase: async () => null,
    },
    getClientIpFromHeaders(request.headers),
    false,
  );

export const getRequestContext = async (request: NextRequest, db: DbExecutor): Promise<RequestContext> =>
  (await getRequestSession(request, db)).context;

/** Server components: same resolution logic, reading cookies and headers via next/headers. */
export const getServerComponentContext = async (): Promise<RequestContext> => {
  const { cookies, headers } = await import('next/headers');
  const cookieStore = await cookies();
  const headerStore = await headers();

  return resolveContext(
    await getDb(),
    {
      read: (name) => cookieStore.get(name)?.value,
      all: () => cookieStore.getAll().map(({ name, value }) => ({ name, value })),
      createSupabase: () => createSupabaseServerComponentClient(),
    },
    getClientIpFromHeaders(headerStore),
  );
};
