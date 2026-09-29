import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { type AuthProfile } from '@/server/auth/AuthProvider';
import { createUserSession, destroySessionToken, setSessionCookie } from '@/server/auth/SessionService';
import { type Db } from '@/server/db/Database';
import { authIdentities, type UserRow, users } from '@/server/db/Schema';
import { type RequestContext } from '@/server/http/RequestContext';
import { buildAppUrl, NO_STORE } from '@/server/http/RouteHelpers';
import { claimAnonymousJobs } from '@/server/services/RecognitionService';

/** Finds the user linked to the provider identity, or creates both (race-safe via the unique identity key). */
export const upsertUserForProfile = async (db: Db, profile: AuthProfile): Promise<UserRow> =>
  db.transaction(async (tx) => {
    const findExisting = async (): Promise<UserRow | null> => {
      const [row] = await tx
        .select({ user: users })
        .from(authIdentities)
        .innerJoin(users, eq(users.id, authIdentities.userId))
        .where(
          and(
            eq(authIdentities.provider, profile.provider),
            eq(authIdentities.providerSubject, profile.subject),
          ),
        )
        .limit(1);

      return row?.user ?? null;
    };

    const existing = await findExisting();

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

    const winner = await findExisting();

    if (!winner) {
      throw new Error('Identity conflict without an existing identity');
    }

    return winner;
  });

/**
 * Shared by OAuth callback and dev login: upsert user, rotate the session, claim the anonymous
 * session's unexpired jobs and redirect to `returnTo` (already sanitized) with the new session cookie.
 */
export const completeLogin = async (
  db: Db,
  context: RequestContext,
  profile: AuthProfile,
  returnTo: string,
  redirectStatus: number,
): Promise<NextResponse> => {
  const user = await upsertUserForProfile(db, profile);

  if (context.sessionToken) {
    await destroySessionToken(db, context.sessionToken);
  }

  const issued = await createUserSession(db, user.id);

  if (context.anonymousSessionId) {
    await claimAnonymousJobs(db, user.id, context.anonymousSessionId);
  }

  const response = NextResponse.redirect(buildAppUrl(returnTo), redirectStatus);

  setSessionCookie(response, issued);
  response.headers.set('Cache-Control', NO_STORE);

  return response;
};
