import type { NextConfig } from 'next';

import { HTML_LIMITED_BOTS } from './src/server/http/HtmlLimitedBots';
import { PUBLIC_SHARE_HEADERS, SHARE_PAGE_HEADERS } from './src/server/http/PublicShareHeaders';

/**
 * Pages whose URL carries a token or an id (invite token, team/job/draft ids): the Referer is the origin only,
 * so neither other sites nor the analytics script (which reports `document.referrer`, Spec §23.4) see that
 * URL. Not `no-referrer`: it makes same-origin form POSTs (logout, demo login) send `Origin: null` (403).
 */
const ID_PAGE_SOURCES = ['/join/:path*', '/teams/:path*', '/recognitions/:path*', '/drafts/:path*'];
const ORIGIN_ONLY_REFERRER_HEADERS = { 'Referrer-Policy': 'strict-origin' };

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

/**
 * tesseract.js pieces the trace misses: the Node worker script (spawned from a runtime path) with its own
 * requires, and the WASM cores it picks by CPU feature (relaxed SIMD, SIMD, plain; read via fs). In
 * tesseract.js 7 the Node worker passes a boolean where `getCore` expects an OEM, so it loads the full
 * cores even for LSTM-only workers: both families are shipped. Paths go through the package's pnpm
 * `node_modules` folder (the symlinks Node resolves from the worker), not the store paths. The browser
 * worker is left out.
 */
const TESSERACT_PACKAGE_DIR = './node_modules/.pnpm/tesseract.js@*/node_modules';
const TESSERACT_TRACE_INCLUDES = [
  `${TESSERACT_PACKAGE_DIR}/tesseract.js/src/worker-script/{index,node/*,utils/*,constants/*}.js`,
  `${TESSERACT_PACKAGE_DIR}/tesseract.js/src/{constants,utils}/*.js`,
  `${TESSERACT_PACKAGE_DIR}/tesseract.js-core/package.json`,
  ...['', '-lstm', '-simd', '-simd-lstm', '-relaxedsimd', '-relaxedsimd-lstm'].flatMap((variant) => [
    `${TESSERACT_PACKAGE_DIR}/tesseract.js-core/tesseract-core${variant}.js`,
    `${TESSERACT_PACKAGE_DIR}/tesseract.js-core/tesseract-core${variant}.wasm`,
  ]),
  `${TESSERACT_PACKAGE_DIR}/{wasm-feature-detect,regenerator-runtime,is-url,bmp-js,zlibjs,idb-keyval}/**/*`,
];

/**
 * Bundled LSTM language data (Spec §22-9): read at runtime from `node_modules/@tesseract.js-data/<lang>`
 * (a path the trace cannot see), so the instance never downloads it or writes a cache.
 */
const OCR_LANGUAGE_DATA_INCLUDES = [
  './node_modules/@tesseract.js-data/{kor,eng}/package.json',
  './node_modules/@tesseract.js-data/{kor,eng}/4.0.0_best_int/*.traineddata.gz',
];

const nextConfig: NextConfig = {
  // tesseract.js starts its worker thread from a path computed at runtime and loads its WASM core via fs,
  // so it must stay a plain node_modules package (not bundled).
  serverExternalPackages: ['sharp', '@electric-sql/pglite', 'pg', 'tesseract.js'],
  // Read at runtime via fs, so they must be traced into server bundles: migration SQL (./drizzle) and
  // the Supabase root CA used to verify the Postgres TLS certificate.
  outputFileTracingIncludes: {
    '/**': ['./drizzle/**/*', './src/server/db/certs/*.crt'],
    // Shadow OCR (Spec §22) runs after the personal extract: the worker script (not statically required)
    // and the LSTM-only WASM cores it picks by CPU features (relaxed SIMD, SIMD, plain). Keys are globs,
    // so `[id]` would be a character class: `*` stands for the dynamic segment.
    '/api/recognitions/*/extract': [...TESSERACT_TRACE_INCLUDES, ...OCR_LANGUAGE_DATA_INCLUDES],
  },
  // Local data (PGlite, storage, an old OCR cache) must never ship with the OCR function.
  outputFileTracingExcludes: {
    '/api/recognitions/*/extract': ['./.data/**/*'],
  },
  poweredByHeader: false,
  // Metadata must be in <head> for link-preview scrapers, including KakaoTalk's.
  htmlLimitedBots: HTML_LIMITED_BOTS,
  // `next dev` would otherwise (re)write an agent-rules block into CLAUDE.md/AGENTS.md.
  agentRules: false,
  headers: async () => [
    { source: '/:path*', headers: toHeaderList(BASELINE_HEADERS) },
    ...ID_PAGE_SOURCES.map((source) => ({ source, headers: toHeaderList(ORIGIN_ONLY_REFERRER_HEADERS) })),
    // Later rules override earlier ones (and route response headers) for the same key, so both the share
    // page and its API get no-referrer, no-store and noindex. The /s/[token] page itself must also be
    // rendered dynamically (never prerendered/ISR-cached), otherwise a stopped link could still be served.
    { source: '/s/:path*', headers: toHeaderList(SHARE_PAGE_HEADERS) },
    { source: '/api/shared/:path*', headers: toHeaderList(PUBLIC_SHARE_HEADERS) },
  ],
};

export default nextConfig;
