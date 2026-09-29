import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@electric-sql/pglite', 'pg'],
  poweredByHeader: false,
};

export default nextConfig;
