import type { NextConfig } from 'next';

import { HTML_LIMITED_BOTS } from './src/server/http/HtmlLimitedBots';
import { PUBLIC_SHARE_HEADERS } from './src/server/http/PublicShareHeaders';

const toHeaderList = (headers: Readonly<Record<string, string>>) =>
  Object.entries(headers).map(([key, value]) => ({ key, value }));

/**
 * Baseline for every response. The CSP only forbids framing us (`frame-ancestors`); a full policy must be
 * designed together with the Toss payment widget (its scripts/iframes are ours to embed, not to frame us).
 */
const BASELINE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@electric-sql/pglite', 'pg'],
  // Read at runtime via fs, so they must be traced into server bundles: migration SQL (./drizzle) and
  // the Supabase root CA used to verify the Postgres TLS certificate.
  outputFileTracingIncludes: {
    '/**': ['./drizzle/**/*', './src/server/db/certs/*.crt'],
  },
  poweredByHeader: false,
  // Metadata must be in <head> for link-preview scrapers, including KakaoTalk's.
  htmlLimitedBots: HTML_LIMITED_BOTS,
  // `next dev` would otherwise (re)write an agent-rules block into CLAUDE.md/AGENTS.md.
  agentRules: false,
  headers: async () => [
    { source: '/:path*', headers: toHeaderList(BASELINE_HEADERS) },
    // Later rules override earlier ones (and route response headers) for the same key, so both the share
    // page and its API get no-referrer, no-store and noindex. The /s/[token] page itself must also be
    // rendered dynamically (never prerendered/ISR-cached), otherwise a stopped link could still be served.
    { source: '/s/:path*', headers: toHeaderList(PUBLIC_SHARE_HEADERS) },
    { source: '/api/shared/:path*', headers: toHeaderList(PUBLIC_SHARE_HEADERS) },
  ],
};

export default nextConfig;
