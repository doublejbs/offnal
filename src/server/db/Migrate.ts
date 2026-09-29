import { createDbHandleFromEnv } from '@/server/db/Database';

const runMigrations = async (): Promise<void> => {
  const handle = createDbHandleFromEnv();

  console.info(`[db:migrate] target: ${handle.driver} (${handle.target})`);

  try {
    await handle.migrate();
    console.info('[db:migrate] migrations applied');
  } finally {
    await handle.close();
  }
};

runMigrations().catch((error: unknown) => {
  console.error('[db:migrate] failed', error);
  process.exitCode = 1;
});
