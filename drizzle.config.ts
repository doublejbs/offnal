import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/Schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
});
