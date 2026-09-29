import { createDbHandleFromEnv } from '@/server/db/Database';

const runMigrations = async (): Promise<void> => {
  // DATABASE_MIGRATION_URL (session pooler/direct) when set: the transaction pooler suits the app, not DDL.
  const handle = createDbHandleFromEnv(process.env, { forMigration: true });

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
