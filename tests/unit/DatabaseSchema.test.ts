import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AuthIdentityProvider } from '@/domain/enums/AuthIdentityProvider';
import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import {
  buildPoolConfig,
  createDbHandleFromEnv,
  createTestDb,
  type Db,
  getDb,
  setDbForTesting,
  type TestDb,
} from '@/server/db/Database';
import { listAppTableRowSecurity, listPublicRoleAccessibleTables } from '@/server/db/DatabaseInspection';
import {
  authIdentities,
  calendars,
  drafts,
  entitlements,
  paymentEvents,
  payments,
  publishedMonths,
  recognitionJobs,
  users,
} from '@/server/db/Schema';

const FAR_FUTURE = new Date('2030-01-01T00:00:00Z');
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

const getSqlState = (error: unknown): string | undefined => {
  let current: unknown = error;

  while (current instanceof Error) {
    const code = (current as Error & { code?: unknown }).code;

    if (typeof code === 'string') {
      return code;
    }

    current = current.cause;
  }

  return undefined;
};

const expectSqlState = async (operation: PromiseLike<unknown>, sqlState: string): Promise<void> => {
  const error = await Promise.resolve(operation).then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error, 'expected the query to fail').not.toBeNull();
  expect(getSqlState(error)).toBe(sqlState);
};

const createUser = async (db: Db, displayName = '김하루'): Promise<string> => {
  const [user] = await db.insert(users).values({ displayName }).returning({ id: users.id });

  if (!user) {
    throw new Error('user insert failed');
  }

  return user.id;
};

const draftValues = (userId: string, recognitionJobId: string | null, personRowId: string | null) => ({
  userId,
  recognitionJobId,
  personRowId,
  yearMonth: '2026-11',
  displayName: '김하루',
  definitions: [],
  entries: [],
  sourceCells: [],
  status: DraftStatus.EDITING,
  expiresAt: FAR_FUTURE,
});

describe('Database schema', () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });

  afterAll(async () => {
    await testDb.close();
  });

  afterEach(() => {
    setDbForTesting(null);
  });

  it('rejects a duplicate entitlement for the same user and month', async () => {
    const userId = await createUser(db);

    await db.insert(entitlements).values({ userId, yearMonth: '2026-10', source: EntitlementSource.TRIAL });
    await expectSqlState(
      db.insert(entitlements).values({ userId, yearMonth: '2026-10', source: EntitlementSource.PURCHASE }),
      UNIQUE_VIOLATION,
    );

    await db.insert(entitlements).values({ userId, yearMonth: '2026-11', source: EntitlementSource.TRIAL });

    const rows = await db.select().from(entitlements).where(eq(entitlements.userId, userId));

    expect(rows).toHaveLength(2);
  });

  it('allows the entitlement insert to be skipped with onConflictDoNothing', async () => {
    const userId = await createUser(db);

    await db
      .insert(entitlements)
      .values({ userId, yearMonth: '2026-10', source: EntitlementSource.PURCHASE });

    const inserted = await db
      .insert(entitlements)
      .values({ userId, yearMonth: '2026-10', source: EntitlementSource.PURCHASE })
      .onConflictDoNothing()
      .returning();

    expect(inserted).toHaveLength(0);
  });

  it('allows one calendar per owner and one published month per calendar', async () => {
    const ownerId = await createUser(db);
    const [calendar] = await db.insert(calendars).values({ ownerId, displayName: '김하루' }).returning();

    await expectSqlState(
      db.insert(calendars).values({ ownerId, displayName: '다른 이름' }),
      UNIQUE_VIOLATION,
    );

    const month = {
      calendarId: calendar!.id,
      yearMonth: '2026-10',
      definitions: [],
      entries: [],
    };

    await db.insert(publishedMonths).values(month);
    await expectSqlState(db.insert(publishedMonths).values(month), UNIQUE_VIOLATION);
  });

  it('enforces unique share token hash', async () => {
    const first = await createUser(db);
    const second = await createUser(db);

    await db.insert(calendars).values({ ownerId: first, displayName: 'a', shareTokenHash: 'hash-1' });
    await expectSqlState(
      db.insert(calendars).values({ ownerId: second, displayName: 'b', shareTokenHash: 'hash-1' }),
      UNIQUE_VIOLATION,
    );
    await db.insert(calendars).values({ ownerId: second, displayName: 'b', shareTokenHash: null });
  });

  it('enforces the partial unique index on drafts only when a recognition job is set', async () => {
    const userId = await createUser(db);
    const [job] = await db
      .insert(recognitionJobs)
      .values({
        userId,
        status: RecognitionStatus.RECOGNIZED,
        sourceMime: ImageMimeType.PNG,
        expiresAt: FAR_FUTURE,
      })
      .returning();

    await db.insert(drafts).values(draftValues(userId, job!.id, 'row-1'));
    await expectSqlState(db.insert(drafts).values(draftValues(userId, job!.id, 'row-1')), UNIQUE_VIOLATION);
    await db.insert(drafts).values(draftValues(userId, job!.id, 'row-2'));
    await db.insert(drafts).values(draftValues(userId, null, null));
    await db.insert(drafts).values(draftValues(userId, null, null));

    const rows = await db.select().from(drafts).where(eq(drafts.userId, userId));

    expect(rows).toHaveLength(4);
  });

  it('enforces unique payment keys and payment events', async () => {
    const userId = await createUser(db);
    const payment = {
      userId,
      yearMonth: '2026-12',
      amount: 1900,
      provider: PaymentProviderType.MOCK,
      status: PaymentStatus.PENDING,
    };

    await db.insert(payments).values({ ...payment, providerPaymentKey: 'mock_success_1' });
    await expectSqlState(
      db.insert(payments).values({ ...payment, providerPaymentKey: 'mock_success_1' }),
      UNIQUE_VIOLATION,
    );
    await db.insert(payments).values(payment);
    await db.insert(payments).values(payment);

    await db.insert(paymentEvents).values({ provider: PaymentProviderType.MOCK, eventKey: 'evt-1' });
    await expectSqlState(
      db.insert(paymentEvents).values({ provider: PaymentProviderType.MOCK, eventKey: 'evt-1' }),
      UNIQUE_VIOLATION,
    );
  });

  it('stores typed jsonb values', async () => {
    const userId = await createUser(db);
    const [draft] = await db
      .insert(drafts)
      .values({
        ...draftValues(userId, null, null),
        definitions: [
          {
            code: 'D',
            label: '데이',
            startTime: '07:00',
            endTime: '16:00',
            endsNextDay: false,
            isOff: false,
          },
        ],
        entries: [{ date: '2026-11-01', code: 'D', reviewReasons: [], confirmed: true }],
      })
      .returning();

    expect(draft?.definitions[0]?.code).toBe('D');
    expect(draft?.entries[0]?.date).toBe('2026-11-01');
    expect(draft?.revision).toBe(1);
  });

  it('runs SELECT ... FOR UPDATE inside a transaction', async () => {
    const userId = await createUser(db);

    const locked = await db.transaction(async (tx) => {
      const rows = await tx.select().from(users).where(eq(users.id, userId)).for('update');

      await tx.insert(entitlements).values({ userId, yearMonth: '2027-01', source: EntitlementSource.TRIAL });

      return rows;
    });

    expect(locked).toHaveLength(1);

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entitlements)
      .where(eq(entitlements.userId, userId));

    expect(row?.count).toBe(1);
  });

  it('rolls back a failed transaction', async () => {
    const userId = await createUser(db);

    await expectSqlState(
      db.transaction(async (tx) => {
        await tx
          .insert(entitlements)
          .values({ userId, yearMonth: '2027-02', source: EntitlementSource.TRIAL });
        await tx
          .insert(entitlements)
          .values({ userId, yearMonth: '2027-02', source: EntitlementSource.TRIAL });
      }),
      UNIQUE_VIOLATION,
    );

    const rows = await db.select().from(entitlements).where(eq(entitlements.userId, userId));

    expect(rows).toHaveLength(0);
  });

  it('rejects malformed year_month values with a CHECK violation', async () => {
    const userId = await createUser(db);

    for (const yearMonth of [
      '2026-13',
      '2026-1',
      '2026-00',
      '202610',
      '2026-10-01',
      '1999-12',
      '2101-01',
      '3000-01',
    ]) {
      await expectSqlState(
        db.insert(entitlements).values({ userId, yearMonth, source: EntitlementSource.TRIAL }),
        CHECK_VIOLATION,
      );
    }

    await expectSqlState(
      db.insert(drafts).values({ ...draftValues(userId, null, null), yearMonth: 'x' }),
      CHECK_VIOLATION,
    );
  });

  it('rejects values outside the enum with a CHECK violation', async () => {
    const userId = await createUser(db);

    await expectSqlState(
      db.insert(drafts).values({ ...draftValues(userId, null, null), status: 'bogus' as DraftStatus }),
      CHECK_VIOLATION,
    );
    await expectSqlState(
      db.insert(entitlements).values({ userId, yearMonth: '2026-10', source: 'gift' as EntitlementSource }),
      CHECK_VIOLATION,
    );
    await expectSqlState(
      db.insert(recognitionJobs).values({
        status: 'done' as RecognitionStatus,
        sourceMime: ImageMimeType.PNG,
        expiresAt: FAR_FUTURE,
      }),
      CHECK_VIOLATION,
    );
    await expectSqlState(
      db.insert(payments).values({
        userId,
        yearMonth: '2026-10',
        amount: 1900,
        provider: 'paypal' as PaymentProviderType,
        status: PaymentStatus.PENDING,
      }),
      CHECK_VIOLATION,
    );
  });

  it('refreshes updated_at on update', async () => {
    const userId = await createUser(db);
    const past = new Date('2020-01-01T00:00:00Z');
    const [draft] = await db
      .insert(drafts)
      .values({ ...draftValues(userId, null, null), updatedAt: past })
      .returning();
    const [updated] = await db
      .update(drafts)
      .set({ displayName: '이여름' })
      .where(eq(drafts.id, draft!.id))
      .returning();

    expect(updated!.updatedAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it('enables row level security on every app table (Supabase access policy)', async () => {
    expect(await listPublicRoleAccessibleTables(db)).toBeNull();

    const tables = await listAppTableRowSecurity(db);

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'users',
        'auth_identities',
        'recognition_jobs',
        'payments',
        'rate_limit_counters',
      ]),
    );
    expect(tables.length).toBeGreaterThanOrEqual(12);
    expect(tables.filter((table) => !table.rowSecurity)).toEqual([]);
  });

  it('revokes Supabase anon/authenticated table privileges when those roles exist', async () => {
    const handle = createDbHandleFromEnv({ OFFNAL_ENV: 'test', PGLITE_DIR: 'memory' });

    try {
      // Mimic a Supabase project: the roles exist and new public tables are granted to them by default.
      await handle.db.execute(sql`create role anon`);
      await handle.db.execute(sql`create role authenticated`);
      await handle.db.execute(
        sql`alter default privileges in schema public grant all on tables to anon, authenticated`,
      );
      await handle.migrate();

      expect(await listPublicRoleAccessibleTables(handle.db)).toEqual([]);
      expect((await listAppTableRowSecurity(handle.db)).every((table) => table.rowSecurity)).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('accepts only supabase and dev identities', async () => {
    const userId = await createUser(db);

    await expectSqlState(
      db.insert(authIdentities).values({
        userId,
        provider: 'google' as AuthIdentityProvider,
        providerSubject: 'google-sub',
      }),
      CHECK_VIOLATION,
    );
    await db
      .insert(authIdentities)
      .values({ userId, provider: AuthIdentityProvider.SUPABASE, providerSubject: randomUUID() });
  });

  it('allows PGlite only in test and keyless demo development', async () => {
    expect(() =>
      createDbHandleFromEnv({ OFFNAL_ENV: 'development', APP_MODE: 'live', PGLITE_DIR: 'memory' }),
    ).toThrow(/DATABASE_URL is required/);

    for (const env of [
      { OFFNAL_ENV: 'test', APP_MODE: 'live', PGLITE_DIR: 'memory' },
      { OFFNAL_ENV: 'development', APP_MODE: 'demo', PGLITE_DIR: 'memory' },
      { OFFNAL_ENV: 'development', PGLITE_DIR: 'memory' },
    ]) {
      const handle = createDbHandleFromEnv(env);

      expect(handle.target).toBe('memory');
      await handle.close();
    }
  });

  it('refuses PGlite outside development and test', () => {
    expect(() => createDbHandleFromEnv({ OFFNAL_ENV: 'production', PGLITE_DIR: 'memory' })).toThrow(
      /DATABASE_URL is required/,
    );
    expect(() => createDbHandleFromEnv({ OFFNAL_ENV: 'preview', PGLITE_DIR: 'memory' })).toThrow(
      /DATABASE_URL is required/,
    );
    expect(() => createDbHandleFromEnv({ NODE_ENV: 'production', PGLITE_DIR: 'memory' })).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('uses node-postgres when DATABASE_URL is set without leaking credentials', async () => {
    const handle = createDbHandleFromEnv({
      OFFNAL_ENV: 'production',
      DATABASE_URL: 'postgres://user:secret@db.example.com:5432/offnal',
    });

    expect(handle.target).toBe('db.example.com:5432/offnal');
    expect(handle.target).not.toContain('secret');

    await handle.close();
  });

  it('returns the overridden database from getDb', async () => {
    setDbForTesting(db);

    await expect(getDb()).resolves.toBe(db);
  });

  it('creates an in-memory database via getDb when PGLITE_DIR=memory', async () => {
    const fromEnv = await getDb();
    const rows = await fromEnv.select().from(users);

    expect(rows).toEqual([]);
  });
});

describe('buildPoolConfig', () => {
  it('uses TLS for Supabase hosts and strips sslmode so the explicit ssl option wins', () => {
    const config = buildPoolConfig(
      'postgresql://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require',
      {},
    );

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.connectionString).not.toContain('sslmode');
    expect(config.max).toBe(5);
  });

  it('verifies the server certificate when a root CA is provided', () => {
    const config = buildPoolConfig('postgresql://postgres:pw@db.ref.supabase.co:5432/postgres', {
      DATABASE_SSL_ROOT_CERT: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
    });

    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    });
  });

  it('keeps plain connections for local Postgres and honours sslmode', () => {
    expect(buildPoolConfig('postgres://user:pw@localhost:5432/offnal', {}).ssl).toBeUndefined();
    expect(buildPoolConfig('postgres://user:pw@db.example.com:5432/offnal?sslmode=require', {}).ssl).toEqual({
      rejectUnauthorized: false,
    });
    expect(
      buildPoolConfig('postgres://user:pw@db.ref.supabase.co:5432/postgres?sslmode=disable', {}).ssl,
    ).toBeUndefined();
  });
});
