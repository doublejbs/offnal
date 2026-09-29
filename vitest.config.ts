import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // Marker package (bundled by Next): a no-op outside the React client graph.
      'server-only': path.resolve(
        import.meta.dirname,
        'node_modules/next/dist/compiled/server-only/empty.js',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/VitestSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
