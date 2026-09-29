import type { NextConfig } from 'next';

import { PUBLIC_SHARE_HEADERS } from './src/server/http/PublicShareHeaders';

const toHeaderList = (headers: Readonly<Record<string, string>>) =>
  Object.entries(headers).map(([key, value]) => ({ key, value }));

/** Baseline for every response. No CSP yet: it must be designed together with the Toss payment widget. */
const BASELINE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'X-Frame-Options': 'SAMEORIGIN',
};

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@electric-sql/pglite', 'pg'],
  // Migration SQL is read at runtime from ./drizzle, so it must be traced into server bundles.
  outputFileTracingIncludes: {
    '/**': ['./drizzle/**/*'],
  },
  poweredByHeader: false,
  headers: async () => [
    { source: '/:path*', headers: toHeaderList(BASELINE_HEADERS) },
    // Later rules override earlier ones (and route response headers) for the same key, so both the share
    // page and its API get no-referrer, no-store and noindex.
    { source: '/s/:path*', headers: toHeaderList(PUBLIC_SHARE_HEADERS) },
    { source: '/api/shared/:path*', headers: toHeaderList(PUBLIC_SHARE_HEADERS) },
  ],
};

export default nextConfig;
