import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { type PgDatabase, type PgQueryResultHKT, type PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { type ExtractTablesWithRelations } from 'drizzle-orm/relations';
import { Pool } from 'pg';

import { DbDriver } from '@/domain/enums/DbDriver';
import * as schema from '@/server/db/Schema';

export type DbSchema = typeof schema;

/** Shared type for both drivers (PGlite and node-postgres). Supports `transaction` and `.for('update')`. */
export type Db = PgDatabase<PgQueryResultHKT, DbSchema>;

export type DbTransaction = PgTransaction<PgQueryResultHKT, DbSchema, ExtractTablesWithRelations<DbSchema>>;

/** Either the root database or an open transaction. */
export type DbExecutor = Db | DbTransaction;

type DbHandle = {
  db: Db;
  driver: DbDriver;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

const MEMORY_PGLITE_DIR = 'memory';
const DEFAULT_PGLITE_DIR = '.data/pglite';

const getMigrationsFolder = (): string => path.join(process.cwd(), 'drizzle');

const createPgliteHandle = (dataDir: string | null): DbHandle => {
  const client = dataDir === null ? new PGlite() : new PGlite(path.resolve(process.cwd(), dataDir));
  const db = drizzlePglite({ client, schema });

  return {
    db,
    driver: DbDriver.PGLITE,
    migrate: async () => {
      await migratePglite(db, { migrationsFolder: getMigrationsFolder() });
    },
    close: async () => {
      await client.close();
    },
  };
};

const createNodePgHandle = (connectionString: string): DbHandle => {
  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzleNodePg({ client: pool, schema });

  return {
    db,
    driver: DbDriver.NODE_POSTGRES,
    migrate: async () => {
      await migrateNodePg(db, { migrationsFolder: getMigrationsFolder() });
    },
    close: async () => {
      await pool.end();
    },
  };
};

/** Creates a database handle from environment variables without applying migrations. */
export const createDbHandleFromEnv = (env: NodeJS.ProcessEnv = process.env): DbHandle => {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return createNodePgHandle(databaseUrl);
  }

  const pgliteDir = env.PGLITE_DIR?.trim() || DEFAULT_PGLITE_DIR;

  return createPgliteHandle(pgliteDir === MEMORY_PGLITE_DIR ? null : pgliteDir);
};

type DbGlobal = typeof globalThis & {
  __offnalDbPromise?: Promise<Db>;
  __offnalDbOverride?: Db | null;
};

const dbGlobal = globalThis as DbGlobal;

const initializeDb = async (): Promise<Db> => {
  const handle = createDbHandleFromEnv();

  // Embedded PGlite is migrated on first use; real Postgres is migrated explicitly via `pnpm db:migrate`.
  if (handle.driver === DbDriver.PGLITE) {
    await handle.migrate();
  }

  return handle.db;
};

/** Returns the process-wide database (lazy, cached across hot reloads). */
export const getDb = async (): Promise<Db> => {
  if (dbGlobal.__offnalDbOverride) {
    return dbGlobal.__offnalDbOverride;
  }

  if (!dbGlobal.__offnalDbPromise) {
    dbGlobal.__offnalDbPromise = initializeDb().catch((error: unknown) => {
      dbGlobal.__offnalDbPromise = undefined;
      throw error;
    });
  }

  return dbGlobal.__offnalDbPromise;
};

/** Overrides the database returned by `getDb` (pass null to clear). Tests only. */
export const setDbForTesting = (db: Db | null): void => {
  dbGlobal.__offnalDbOverride = db;
};

/** Fresh in-memory PGlite database with all migrations applied. */
export const createTestDb = async (): Promise<Db> => {
  const handle = createPgliteHandle(null);

  await handle.migrate();

  return handle.db;
};
