import { decodeIdToken, Google } from 'arctic';
import { z } from 'zod';

import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { type AuthProfile, type OAuthAuthProvider } from '@/server/auth/AuthProvider';

const GOOGLE_SCOPES = ['openid', 'profile', 'email'];
const FALLBACK_DISPLAY_NAME = '오프날 사용자';
const MAX_DISPLAY_NAME_LENGTH = 40;

const idTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

export type GoogleAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const pickDisplayName = (claims: z.infer<typeof idTokenClaimsSchema>): string => {
  const name = claims.name?.trim() || claims.email?.split('@')[0]?.trim() || FALLBACK_DISPLAY_NAME;

  return name.slice(0, MAX_DISPLAY_NAME_LENGTH);
};

export const createGoogleAuthProvider = (config: GoogleAuthConfig): OAuthAuthProvider => {
  const google = new Google(config.clientId, config.clientSecret, config.redirectUri);

  return {
    kind: AuthProviderType.GOOGLE,
    createAuthorizationUrl: (state, codeVerifier) =>
      google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES),
    exchangeCode: async (code, codeVerifier): Promise<AuthProfile> => {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      // The ID token comes straight from Google's token endpoint over TLS, so decoding without signature check is safe.
      const claims = idTokenClaimsSchema.parse(decodeIdToken(tokens.idToken()));

      return {
        provider: AuthProviderType.GOOGLE,
        subject: claims.sub,
        email: claims.email_verified === false ? null : (claims.email ?? null),
        displayName: pickDisplayName(claims),
      };
    },
  };
};
