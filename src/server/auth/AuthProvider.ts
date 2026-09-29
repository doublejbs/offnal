import { type AuthProviderType } from '@/domain/enums/AuthProviderType';

/** Identity returned by a login provider after successful authentication. */
export type AuthProfile = {
  provider: AuthProviderType;
  /** Stable provider-side user ID (e.g. Google `sub`). */
  subject: string;
  email: string | null;
  displayName: string;
};

export type AuthProvider = {
  readonly kind: AuthProviderType;
};

/** Redirect-based provider (authorization code + PKCE). */
export type OAuthAuthProvider = AuthProvider & {
  createAuthorizationUrl: (state: string, codeVerifier: string) => URL;
  /** Throws when the code is invalid or the provider rejects it. */
  exchangeCode: (code: string, codeVerifier: string) => Promise<AuthProfile>;
};
