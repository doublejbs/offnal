import { and, eq } from 'drizzle-orm';

import { type AuthProfile } from '@/server/auth/AuthProvider';
import { createUserSession, destroySessionToken, type IssuedToken } from '@/server/auth/SessionService';
import { type Db, type DbTransaction } from '@/server/db/Database';
import { authIdentities, type UserRow, users } from '@/server/db/Schema';
import { type RequestContext } from '@/server/http/RequestContext';
import { claimAnonymousJobs } from '@/server/services/RecognitionOwnership';

export type LoginResult = {
  user: UserRow;
  session: IssuedToken;
  claimedJobCount: number;
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

/**
 * Shared by the OAuth callback and dev login, in one transaction: upsert the user, replace the
 * previous session (rotation) and claim the anonymous session's unexpired jobs. The route sets
 * the returned session cookie and redirects.
 */
export const completeLogin = async (
  db: Db,
  context: RequestContext,
  profile: AuthProfile,
): Promise<LoginResult> =>
  db.transaction(async (tx) => {
    const user = await upsertUserForProfile(tx, profile);

    if (context.sessionToken) {
      await destroySessionToken(tx, context.sessionToken);
    }

    const session = await createUserSession(tx, user.id);
    const claimedJobCount = context.anonymousSessionId
      ? await claimAnonymousJobs(tx, user.id, context.anonymousSessionId)
      : 0;

    return { user, session, claimedJobCount };
  });
