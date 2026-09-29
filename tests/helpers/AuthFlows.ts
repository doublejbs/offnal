import { and, eq } from 'drizzle-orm';

import { GET as candidatesRoute } from '@/app/api/recognitions/[id]/candidates/route';
import { GET as callbackRoute } from '@/app/auth/callback/route';
import { GET as loginRoute } from '@/app/auth/login/route';
import { AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { type Db } from '@/server/db/Database';
import { authIdentities, recognitionJobs } from '@/server/db/Schema';
import { type ApiTestClient } from './ApiTestClient';

/** returnTo values that must never leave the app origin. */
export const OPEN_REDIRECT_PROBES = [
  '//evil.example/x',
  'https://evil.example',
  '/\\evil.example',
  'relative',
  '/.//evil.example',
  '/a/..//evil.example',
];

export const requestCandidates = async (client: ApiTestClient, jobId: string): Promise<Response> =>
  client.send(candidatesRoute, `/api/recognitions/${jobId}/candidates`, { params: { id: jobId } });

export const findJobOwner = async (db: Db, jobId: string): Promise<string | null> => {
  const [job] = await db
    .select({ userId: recognitionJobs.userId })
    .from(recognitionJobs)
    .where(eq(recognitionJobs.id, jobId));

  return job?.userId ?? null;
};

export const findSupabaseIdentities = async (db: Db, subject: string) =>
  db
    .select({ userId: authIdentities.userId, email: authIdentities.email })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, AuthIdentityProvider.SUPABASE),
        eq(authIdentities.providerSubject, subject),
      ),
    );

/** Full Kakao round trip through the (fake) Supabase client: /auth/login, then the callback with `code`. */
export const kakaoLogin = async (
  client: ApiTestClient,
  code: string,
  returnTo: string,
): Promise<Response> => {
  await client.send(loginRoute, `/auth/login?provider=kakao&returnTo=${encodeURIComponent(returnTo)}`);

  return client.send(callbackRoute, `/auth/callback?code=${code}&returnTo=${encodeURIComponent(returnTo)}`);
};
