import { and, eq } from 'drizzle-orm';

import { type AuthProfile } from '@/server/auth/AuthProvider';
import { createUserSession, destroySessionToken, type IssuedToken } from '@/server/auth/SessionService';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { authIdentities, type UserRow, users } from '@/server/db/Schema';
import { type RequestContext } from '@/server/http/RequestContext';
import { claimAnonymousJobs } from '@/server/services/RecognitionOwnership';

export type IdentityLoginResult = {
  user: UserRow;
  claimedJobCount: number;
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
export const upsertUserForProfile = async (tx: DbTransaction, profile: AuthProfile): Promise<UserRow> => {
  const existing = await findUserByIdentity(tx, profile);

  if (existing) {
    return existing;
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
    return created;
  }

  // A concurrent login created the identity first: drop our user and use theirs.
  await tx.delete(users).where(eq(users.id, created.id));

  const winner = await findUserByIdentity(tx, profile);

  if (!winner) {
    throw new Error('Identity conflict without an existing identity');
  }

  return winner;
};

/** Upserts the user, drops a previous demo session and claims the anonymous session's unexpired jobs. */
const linkIdentity = async (
  tx: DbTransaction,
  context: RequestContext,
  profile: AuthProfile,
): Promise<IdentityLoginResult> => {
  const user = await upsertUserForProfile(tx, profile);

  if (context.sessionToken) {
    await destroySessionToken(tx, context.sessionToken);
  }

  const claimedJobCount = context.anonymousSessionId
    ? await claimAnonymousJobs(tx, user.id, context.anonymousSessionId)
    : 0;

  return { user, claimedJobCount };
};

/**
 * Supabase (Kakao) callback, in one transaction. No app session is issued: the Supabase session
 * cookies are the session, resolved per request by RequestContext via `auth_identities`.
 */
export const completeSupabaseLogin = async (
  db: Db,
  context: RequestContext,
  profile: AuthProfile,
): Promise<IdentityLoginResult> => db.transaction(async (tx) => linkIdentity(tx, context, profile));

/**
 * Demo login, in one transaction: same linking plus a new `offnal_session` (rotation). The route
 * sets the returned session cookie and redirects.
 */
export const completeDemoLogin = async (
  db: Db,
  context: RequestContext,
  profile: AuthProfile,
): Promise<LoginResult> =>
  db.transaction(async (tx) => {
    const result = await linkIdentity(tx, context, profile);
    const session = await createUserSession(tx, result.user.id);

    return { ...result, session };
  });
