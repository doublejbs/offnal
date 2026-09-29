import { createDbHandleFromEnv } from '@/server/db/Database';

const runMigrations = async (): Promise<void> => {
  const handle = createDbHandleFromEnv();

  try {
    await handle.migrate();
    console.info(`[db:migrate] migrations applied (${handle.driver})`);
  } finally {
    await handle.close();
  }
};

runMigrations().catch((error: unknown) => {
  console.error('[db:migrate] failed', error);
  process.exitCode = 1;
});
