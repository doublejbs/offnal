import { type NextRequest, NextResponse } from 'next/server';

import { isKakaoLoginEnabled } from '@/server/auth/AuthProviderRegistry';
import {
  getSupabaseClientFactory,
  getSupabaseSettings,
  hasSupabaseCookies,
  type SupabaseSettings,
} from '@/server/auth/SupabaseServerClient';

/**
 * Next 16 Proxy (formerly Middleware): refreshes the Supabase session cookies before pages and API
 * routes run, following the @supabase/ssr guide. Refreshed cookies are written to the request (so
 * the handler verifies the new token) and to the response (so the browser keeps the rotated refresh
 * token). A no-op without Supabase settings (demo/test) or without Supabase cookies.
 */
export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  let response = NextResponse.next({ request });
  let settings: SupabaseSettings | null = null;

  try {
    settings = isKakaoLoginEnabled() ? getSupabaseSettings() : null;
  } catch {
    // Invalid configuration: let the route itself report it instead of failing every request here.
    return response;
  }

  if (!settings || !hasSupabaseCookies(request.cookies.getAll())) {
    return response;
  }

  const auth = getSupabaseClientFactory()(settings, {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }

      response = NextResponse.next({ request });

      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }

      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
    },
  });

  // Verifies (and, when expiring, refreshes) the session. Never getSession() here: it does not verify.
  await auth.getClaims().catch(() => null);

  return response;
};

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/payments/webhook|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
