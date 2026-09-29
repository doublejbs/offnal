import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { type PgDatabase, type PgQueryResultHKT, type PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { type ExtractTablesWithRelations } from 'drizzle-orm/relations';
import { Pool, type PoolConfig } from 'pg';

import { AppMode } from '@/domain/enums/AppMode';
import { DbDriver } from '@/domain/enums/DbDriver';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import * as schema from '@/server/db/Schema';

export type DbSchema = typeof schema;

/** Shared type for both drivers (PGlite and node-postgres). Supports `transaction` and `.for('update')`. */
export type Db = PgDatabase<PgQueryResultHKT, DbSchema>;

export type DbTransaction = PgTransaction<PgQueryResultHKT, DbSchema, ExtractTablesWithRelations<DbSchema>>;

/** Either the root database or an open transaction. */
export type DbExecutor = Db | DbTransaction;

export type DbHandle = {
  db: Db;
  driver: DbDriver;
  /** Human-readable target without credentials (host/database or PGlite directory). */
  target: string;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

type RawEnv = Record<string, string | undefined>;

const MEMORY_PGLITE_DIR = 'memory';
const DEFAULT_PGLITE_DIR = '.data/pglite';
/** Serverless: every warm function instance holds its own pool, so keep it small (Supabase pooler limits). */
const POOL_MAX_CONNECTIONS = 5;
const SUPABASE_HOST_SUFFIXES = ['.supabase.com', '.supabase.co'];
/** libpq TLS parameters: node-postgres would let them override the explicit `ssl` option. */
const SSL_URL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];
const SSL_REQUIRED_MODES = new Set(['require', 'verify-ca', 'verify-full', 'prefer']);

const getMigrationsFolder = (): string => path.join(process.cwd(), 'drizzle');

const createPgliteClient = (dataDir: string | null): PGlite => {
  if (dataDir === null) {
    return new PGlite();
  }

  // Runtime-configured dev directory: exclude it from output file tracing.
  const resolvedDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), dataDir);

  mkdirSync(path.dirname(resolvedDir), { recursive: true });

  return new PGlite(resolvedDir);
};

const createPgliteHandle = (dataDir: string | null): DbHandle => {
  const client = createPgliteClient(dataDir);
  const db = drizzlePglite({ client, schema });

  return {
    db,
    driver: DbDriver.PGLITE,
    target: dataDir ?? MEMORY_PGLITE_DIR,
    migrate: async () => {
      await migratePglite(db, { migrationsFolder: getMigrationsFolder() });
    },
    close: async () => {
      await client.close();
    },
  };
};

const describeConnectionTarget = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);

    return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  } catch {
    return 'unparsable DATABASE_URL';
  }
};

const readSslRootCert = (env: RawEnv): string | null => {
  const value = env.DATABASE_SSL_ROOT_CERT?.trim();

  // .env files usually carry the PEM on one line with literal "\n".
  return value ? value.replace(/\\n/g, '\n') : null;
};

const resolveSsl = (url: URL, env: RawEnv): PoolConfig['ssl'] => {
  const sslMode = url.searchParams.get('sslmode');

  if (sslMode === 'disable') {
    return undefined;
  }

  const isSupabaseHost = SUPABASE_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));

  if (!isSupabaseHost && !(sslMode && SSL_REQUIRED_MODES.has(sslMode))) {
    return undefined;
  }

  const ca = readSslRootCert(env);

  // Supabase signs server certificates with its own root CA (Dashboard → Database Settings → SSL
  // Configuration), not a publicly trusted one: verify when that CA is provided, otherwise encrypt only.
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
};

/**
 * node-postgres pool settings: TLS for Supabase hosts or `sslmode=require|verify-*` (libpq TLS
 * params are stripped from the URL so the explicit `ssl` option applies), small pool for serverless.
 */
export const buildPoolConfig = (connectionString: string, env: RawEnv = process.env): PoolConfig => {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString, max: POOL_MAX_CONNECTIONS };
  }

  const ssl = resolveSsl(url, env);

  for (const param of SSL_URL_PARAMS) {
    url.searchParams.delete(param);
  }

  return { connectionString: url.toString(), max: POOL_MAX_CONNECTIONS, ...(ssl ? { ssl } : {}) };
};

const createNodePgHandle = (connectionString: string, env: RawEnv = process.env): DbHandle => {
  const pool = new Pool(buildPoolConfig(connectionString, env));
  const db = drizzleNodePg({ client: pool, schema });

  return {
    db,
    driver: DbDriver.NODE_POSTGRES,
    target: describeConnectionTarget(connectionString),
    migrate: async () => {
      await migrateNodePg(db, { migrationsFolder: getMigrationsFolder() });
    },
    close: async () => {
      await pool.end();
    },
  };
};

/**
 * PGlite only for automated tests and keyless demo development (Spec §1): OFFNAL_ENV=test, or
 * development with APP_MODE=demo (the development default when APP_MODE is unset).
 */
const isPgliteAllowed = (env: RawEnv): boolean => {
  // Unset OFFNAL_ENV falls back to NODE_ENV so a production build never silently uses PGlite.
  const offnalEnv =
    env.OFFNAL_ENV?.trim() || (env.NODE_ENV === 'production' ? OffnalEnv.PRODUCTION : OffnalEnv.DEVELOPMENT);
  const appMode = env.APP_MODE?.trim() || AppMode.DEMO;

  return offnalEnv === OffnalEnv.TEST || (offnalEnv === OffnalEnv.DEVELOPMENT && appMode === AppMode.DEMO);
};

export type DbHandleOptions = {
  /** `pnpm db:migrate`: prefer DATABASE_MIGRATION_URL (Supabase session pooler or direct connection). */
  forMigration?: boolean;
};

/** Creates a database handle from environment variables without applying migrations. */
export const createDbHandleFromEnv = (env: RawEnv = process.env, options: DbHandleOptions = {}): DbHandle => {
  const databaseUrl =
    (options.forMigration ? env.DATABASE_MIGRATION_URL?.trim() : undefined) || env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return createNodePgHandle(databaseUrl, env);
  }

  if (!isPgliteAllowed(env)) {
    throw new Error(
      'DATABASE_URL is required; PGlite is only allowed with OFFNAL_ENV=test or in development with APP_MODE=demo.',
    );
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

export type TestDb = {
  db: Db;
  close: () => Promise<void>;
};

const TEST_DATABASE_PREFIX = 'offnal_test_';

/** Throwaway database on a real Postgres server (TEST_DATABASE_URL): created, migrated, dropped on close. */
const createPostgresTestDb = async (baseUrl: string): Promise<TestDb> => {
  const databaseName = `${TEST_DATABASE_PREFIX}${randomUUID().replace(/-/g, '')}`;
  const adminPool = new Pool({ connectionString: baseUrl, max: 1 });

  await adminPool.query(`CREATE DATABASE "${databaseName}"`);

  const url = new URL(baseUrl);

  url.pathname = `/${databaseName}`;

  const handle = createNodePgHandle(url.toString());

  await handle.migrate();

  return {
    db: handle.db,
    close: async () => {
      await handle.close();
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    },
  };
};

/**
 * Fresh database with all migrations applied. Call `close` in `afterAll`.
 * Default: in-memory PGlite (single connection, so concurrent transactions are serialized anyway).
 * With TEST_DATABASE_URL: a new database per call on that Postgres server, so row locks
 * (`FOR UPDATE`) and concurrent transactions are exercised for real (`pnpm test:pg`).
 */
export const createTestDb = async (): Promise<TestDb> => {
  const postgresUrl = process.env.TEST_DATABASE_URL?.trim();

  if (postgresUrl) {
    return createPostgresTestDb(postgresUrl);
  }

  if (process.env.OFFNAL_REQUIRE_TEST_PG === '1') {
    throw new Error('TEST_DATABASE_URL is required for pnpm test:pg');
  }

  const handle = createPgliteHandle(null);

  await handle.migrate();

  return { db: handle.db, close: handle.close };
};
