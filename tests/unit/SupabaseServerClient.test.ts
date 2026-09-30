import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { createKakaoAuthProvider } from '@/server/auth/KakaoAuthProvider';
import {
  createSupabaseRouteClient,
  readVerifiedSupabaseUserId,
  type SupabaseSettings,
} from '@/server/auth/SupabaseServerClient';

const SETTINGS: SupabaseSettings = {
  url: 'https://test-ref.supabase.co',
  publishableKey: 'sb_publishable_test',
};
const APP_URL = 'http://localhost:3100';

const buildRequest = (cookie?: string): NextRequest =>
  new NextRequest(new URL('/auth/login', APP_URL), { headers: cookie ? { cookie } : {} });

// Real @supabase/ssr client (no network: signInWithOAuth with skipBrowserRedirect only builds the URL).
describe('Supabase route client (real @supabase/ssr)', () => {
  it('builds the Kakao PKCE URL and writes the HttpOnly code verifier cookie onto the response', async () => {
    const client = createSupabaseRouteClient(buildRequest(), SETTINGS);

    expect(client).not.toBeNull();

    const provider = createKakaoAuthProvider(client!.auth, APP_URL);
    const url = new URL(await provider.createAuthorizationUrl('/recognitions/abc'));
    const response = client!.applyCookies(NextResponse.redirect(url, 302));
    // @supabase/auth-js 2.117 stores one verifier per PKCE flow (`...-flow-<id>-code-verifier`).
    const verifierCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.includes('code-verifier='));

    expect(url.origin).toBe(SETTINGS.url);
    expect(url.pathname).toBe('/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('kakao');
    expect(url.searchParams.get('redirect_to')).toBe(
      `${APP_URL}/auth/callback?returnTo=%2Frecognitions%2Fabc`,
    );
    expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
    expect(url.searchParams.has('scopes')).toBe(false);
    expect(verifierCookie).toMatch(/^sb-test-ref-auth-token-[\w-]*code-verifier=/);
    expect(verifierCookie).toMatch(/HttpOnly/i);
    expect(verifierCookie).toMatch(/SameSite=lax/i);
  });

  it('reports no user for a request without a session and never throws on garbage cookies', async () => {
    const empty = createSupabaseRouteClient(buildRequest(), SETTINGS);
    const garbage = createSupabaseRouteClient(buildRequest('sb-test-ref-auth-token=not-a-session'), SETTINGS);

    expect(await readVerifiedSupabaseUserId(empty!.auth)).toBeNull();
    expect(await readVerifiedSupabaseUserId(garbage!.auth)).toBeNull();
  });

  it('is null without Supabase settings', () => {
    expect(createSupabaseRouteClient(buildRequest(), null)).toBeNull();
  });

  it('leaves a response untouched when Supabase wrote nothing', () => {
    const client = createSupabaseRouteClient(buildRequest(), SETTINGS);
    const response = new Response('ok');

    expect(client!.applyCookies(response)).toBe(response);
  });
});
