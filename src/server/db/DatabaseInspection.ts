import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { type DbExecutor } from '@/server/db/Database';

export type TableRowSecurity = {
  name: string;
  rowSecurity: boolean;
};

const rowSecuritySchema = z.object({ name: z.string(), row_security: z.boolean() });
const countSchema = z.object({ count: z.coerce.number() });

/** Both drivers (PGlite, node-postgres) return `{ rows }` from `execute`. */
const readRows = (result: unknown): unknown[] => {
  const rows = (result as { rows?: unknown } | null)?.rows;

  return Array.isArray(rows) ? rows : [];
};

/** Every ordinary table in `public` (the app tables) with its `relrowsecurity` flag. */
export const listAppTableRowSecurity = async (db: DbExecutor): Promise<TableRowSecurity[]> => {
  const result = await db.execute(sql`
    select c.relname as name, c.relrowsecurity as row_security
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `);

  return readRows(result).map((row) => {
    const parsed = rowSecuritySchema.parse(row);

    return { name: parsed.name, rowSecurity: parsed.row_security };
  });
};

/** Applied Drizzle migrations (null when the migrations table does not exist yet). */
export const countAppliedMigrations = async (db: DbExecutor): Promise<number | null> => {
  const exists = await db.execute(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  const present = (readRows(exists)[0] as { present?: unknown } | undefined)?.present === true;

  if (!present) {
    return null;
  }

  const result = await db.execute(sql`select count(*) as count from drizzle.__drizzle_migrations`);

  return countSchema.parse(readRows(result)[0]).count;
};

const tableNameSchema = z.object({ name: z.string() });

/**
 * App tables that Supabase's `anon`/`authenticated` roles (Data API keys) still hold privileges on.
 * Null when those roles do not exist (PGlite, plain Postgres).
 */
export const listPublicRoleAccessibleTables = async (db: DbExecutor): Promise<string[] | null> => {
  const roles = await db.execute(
    sql`select count(*) as count from pg_roles where rolname in ('anon', 'authenticated')`,
  );

  if (countSchema.parse(readRows(roles)[0]).count < 2) {
    return null;
  }

  const result = await db.execute(sql`
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (
        has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
      )
    order by c.relname
  `);

  return readRows(result).map((row) => tableNameSchema.parse(row).name);
};

export type MockPaymentData = {
  payments: number;
  entitlements: number;
};

const mockCountsSchema = z.object({ payments: z.coerce.number(), entitlements: z.coerce.number() });

/** Test-payment leftovers (mock provider) that must not survive into production data. */
export const countMockPaymentData = async (db: DbExecutor): Promise<MockPaymentData> => {
  const result = await db.execute(sql`
    select
      (select count(*) from payments where provider = 'mock') as payments,
      (select count(*) from entitlements e join payments p on p.id = e.payment_id where p.provider = 'mock')
        as entitlements
  `);

  return mockCountsSchema.parse(readRows(result)[0]);
};
