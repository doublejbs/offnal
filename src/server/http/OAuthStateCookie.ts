import { type NextRequest, type NextResponse } from 'next/server';
import { z } from 'zod';

import { getAppConfig } from '@/server/config/AppConfig';
import { decryptText, encryptText } from '@/server/crypto/TokenCrypto';
import { buildCookieOptions, clearCookie } from '@/server/http/SessionCookies';

export const OAUTH_STATE_COOKIE_NAME = 'offnal_oauth';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ENCRYPTION_INFO = 'offnal-oauth-state';

const storedStateSchema = z.object({
  provider: z.string(),
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  returnTo: z.string(),
});

export type OAuthState = z.infer<typeof storedStateSchema>;

/** Short-lived, encrypted (AES-GCM, tamper-evident) HttpOnly cookie carrying state, PKCE verifier and returnTo. */
export const setOAuthStateCookie = (response: NextResponse, value: OAuthState): void => {
  const payload = encryptText(JSON.stringify(value), getAppConfig().appSecret, ENCRYPTION_INFO);

  response.cookies.set(
    OAUTH_STATE_COOKIE_NAME,
    payload,
    buildCookieOptions(new Date(Date.now() + OAUTH_STATE_TTL_MS)),
  );
};

export const readOAuthStateCookie = (request: NextRequest): OAuthState | null => {
  const payload = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;

  if (!payload) {
    return null;
  }

  try {
    return storedStateSchema.parse(
      JSON.parse(decryptText(payload, getAppConfig().appSecret, ENCRYPTION_INFO)),
    );
  } catch {
    return null;
  }
};

export const clearOAuthStateCookie = (response: NextResponse): void => {
  clearCookie(response, OAUTH_STATE_COOKIE_NAME);
};
