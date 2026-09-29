import 'server-only';

import { type User } from '@supabase/supabase-js';

import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type AuthProfile, type AuthProvider } from '@/server/auth/AuthProvider';
import { type SupabaseAuthApi } from '@/server/auth/SupabaseServerClient';

export const OAUTH_CALLBACK_PATH = '/auth/callback';
export const RETURN_TO_PARAM = 'returnTo';
export const FALLBACK_DISPLAY_NAME = '오프날 사용자';

/** user_metadata keys Supabase fills from the Kakao profile, in preference order. */
const DISPLAY_NAME_KEYS = ['nickname', 'name', 'full_name', 'preferred_username', 'user_name'];

export type KakaoAuthProvider = AuthProvider & {
  /** Starts Supabase's PKCE flow; the verifier cookie is written through the client's cookie adapter. */
  createAuthorizationUrl: (returnTo: string) => Promise<string>;
  /** Exchanges the callback code for a Supabase session (cookies via the adapter). Throws on failure. */
  exchangeCode: (code: string) => Promise<AuthProfile>;
};

export class SupabaseAuthFailure extends Error {
  constructor(
    readonly step: string,
    readonly code: string | undefined,
  ) {
    super(`Supabase ${step} failed`);
    this.name = 'SupabaseAuthFailure';
  }
}

const pickDisplayName = (user: User): string => {
  const metadata: Record<string, unknown> = user.user_metadata ?? {};

  for (const key of DISPLAY_NAME_KEYS) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
  }

  return FALLBACK_DISPLAY_NAME;
};

export const toSupabaseProfile = (user: User): AuthProfile => ({
  provider: AuthIdentityProvider.SUPABASE,
  subject: user.id,
  email: user.email?.trim() || null,
  displayName: pickDisplayName(user),
});

export const buildCallbackUrl = (appUrl: string, returnTo: string): string => {
  const url = new URL(OAUTH_CALLBACK_PATH, appUrl);

  url.searchParams.set(RETURN_TO_PARAM, returnTo);

  return url.toString();
};

/**
 * Kakao login through Supabase Auth. No `scopes` option: Supabase always requests its default Kakao
 * scopes (account_email, profile_image, profile_nickname) and only appends extra ones, so the scope
 * set is controlled by the Kakao console consent items, not here.
 *
 * PKCE limitation: the callback exchanges without a `flowId`, so @supabase/auth-js uses the most
 * recently stored code verifier. If the same browser starts two logins at once (two tabs), the
 * first tab to return may pick the other tab's verifier and fail with `login=failed`; retrying works.
 */
export const createKakaoAuthProvider = (auth: SupabaseAuthApi, appUrl: string): KakaoAuthProvider => ({
  kind: AuthProviderType.KAKAO,
  createAuthorizationUrl: async (returnTo) => {
    const { data, error } = await auth.signInWithOAuth({
      provider: 'kakao',
      options: { redirectTo: buildCallbackUrl(appUrl, returnTo), skipBrowserRedirect: true },
    });

    if (error || !data.url) {
      throw new SupabaseAuthFailure('signInWithOAuth', error?.code);
    }

    return data.url;
  },
  exchangeCode: async (code) => {
    const { data, error } = await auth.exchangeCodeForSession(code);

    if (error || !data.user) {
      throw new SupabaseAuthFailure('exchangeCodeForSession', error?.code);
    }

    return toSupabaseProfile(data.user);
  },
});
