import { and, eq } from 'drizzle-orm';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { track } from '@/server/analytics/Analytics';
import { type AuthProfile } from '@/server/auth/AuthProvider';
import { createUserSession, destroySessionToken, type IssuedToken } from '@/server/auth/SessionService';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { authIdentities, type UserRow, users } from '@/server/db/Schema';
import { type RequestContext } from '@/server/http/RequestContext';
import { claimAnonymousJobs, trackJobClaimed } from '@/server/services/RecognitionOwnership';

export type IdentityLoginResult = {
  user: UserRow;
  claimedJobCount: number;
};

/** Linking outcome inside the transaction; analytics are recorded only after commit. */
type LinkedIdentity = IdentityLoginResult & {
  firstLogin: boolean;
  claimedJobIds: string[];
};

type UpsertedUser = {
  user: UserRow;
  /** This login created the user (first login with this identity). */
  created: boolean;
};

/** Demo login: also issues the app's own `offnal_session`. */
export type LoginResult = IdentityLoginResult & {
  session: IssuedToken;
};

const findUserByIdentity = async (tx: DbTransaction, profile: AuthProfile): Promise<UserRow | null> => {
  const [row] = await tx
    .select({ user: users })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(eq(authIdentities.provider, profile.provider), eq(authIdentities.providerSubject, profile.subject)),
    )
    .limit(1);

  return row?.user ?? null;
};

/** Finds the user linked to the provider identity, or creates both (race-safe via the unique identity key). */
export const upsertUserForProfile = async (
  tx: DbTransaction,
  profile: AuthProfile,
): Promise<UpsertedUser> => {
  const existing = await findUserByIdentity(tx, profile);

  if (existing) {
    return { user: existing, created: false };
  }

  const [created] = await tx.insert(users).values({ displayName: profile.displayName }).returning();

  if (!created) {
    throw new Error('User insert returned no row');
  }

  const linked = await tx
    .insert(authIdentities)
    .values({
      userId: created.id,
      provider: profile.provider,
      providerSubject: profile.subject,
      email: profile.email,
    })
    .onConflictDoNothing()
    .returning({ id: authIdentities.id });

  if (linked.length > 0) {
    return { user: created, created: true };
  }

  // A concurrent login created the identity first: drop our user and use theirs.
  await tx.delete(users).where(eq(users.id, created.id));

  const winner = await findUserByIdentity(tx, profile);

  if (!winner) {
    throw new Error('Identity conflict without an existing identity');
  }

  return { user: winner, created: false };
};

/** Upserts the user, drops a previous demo session and claims the anonymous session's unexpired jobs. */
const linkIdentity = async (
  tx: DbTransaction,
  context: RequestContext,
  profile: AuthProfile,
): Promise<LinkedIdentity> => {
  const { user, created } = await upsertUserForProfile(tx, profile);

  if (context.sessionToken) {
    await destroySessionToken(tx, context.sessionToken);
  }

  const claimedJobIds = context.anonymousSessionId
    ? await claimAnonymousJobs(tx, user.id, context.anonymousSessionId)
    : [];

  return { user, claimedJobCount: claimedJobIds.length, firstLogin: created, claimedJobIds };
};

/** `login_completed` and one `job_claimed` per job taken over (Spec §23.3), after the commit. */
const trackLogin = ({ user, firstLogin, claimedJobIds }: LinkedIdentity): void => {
  track(AnalyticsEvent.LOGIN_COMPLETED, { actorUserId: user.id, properties: { firstLogin } });

  for (const jobId of claimedJobIds) {
    trackJobClaimed(user.id, jobId);
  }
};

const toIdentityResult = ({ user, claimedJobCount }: LinkedIdentity): IdentityLoginResult => ({
  user,
  claimedJobCount,
});

/**
 * Supabase (Kakao) callback, in one transaction. No app session is issued: the Supabase session
 * cookies are the session, resolved per request by RequestContext via `auth_identities`.
 */
export const completeSupabaseLogin = async (
  db: Db,
  context: RequestContext,
  profile: AuthProfile,
): Promise<IdentityLoginResult> => {
  const linked = await db.transaction(async (tx) => linkIdentity(tx, context, profile));

  trackLogin(linked);

  return toIdentityResult(linked);
};

/**
 * Demo login, in one transaction: same linking plus a new `offnal_session` (rotation). The route
 * sets the returned session cookie and redirects.
 */
export const completeDemoLogin = async (
  db: Db,
  context: RequestContext,
  profile: AuthProfile,
): Promise<LoginResult> => {
  const { linked, session } = await db.transaction(async (tx) => {
    const result = await linkIdentity(tx, context, profile);

    return { linked: result, session: await createUserSession(tx, result.user.id) };
  });

  trackLogin(linked);

  return { ...toIdentityResult(linked), session };
};
