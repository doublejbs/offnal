import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@electric-sql/pglite', 'pg'],
  // Migration SQL is read at runtime from ./drizzle, so it must be traced into server bundles.
  outputFileTracingIncludes: {
    '/**': ['./drizzle/**/*'],
  },
  poweredByHeader: false,
};

export default nextConfig;
