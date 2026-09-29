import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DraftStatus } from '@/domain/enums/DraftStatus';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';
import { createTestDb, type Db, getDb, setDbForTesting } from '@/server/db/Database';
import {
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
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    setDbForTesting(null);
  });

  it('rejects a duplicate entitlement for the same user and month', async () => {
    const userId = await createUser(db);

    await db.insert(entitlements).values({ userId, yearMonth: '2026-10', source: EntitlementSource.TRIAL });
    await expect(
      db.insert(entitlements).values({ userId, yearMonth: '2026-10', source: EntitlementSource.PURCHASE }),
    ).rejects.toThrow();

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

    await expect(db.insert(calendars).values({ ownerId, displayName: '다른 이름' })).rejects.toThrow();

    const month = {
      calendarId: calendar!.id,
      yearMonth: '2026-10',
      definitions: [],
      entries: [],
    };

    await db.insert(publishedMonths).values(month);
    await expect(db.insert(publishedMonths).values(month)).rejects.toThrow();
  });

  it('enforces unique share token hash', async () => {
    const first = await createUser(db);
    const second = await createUser(db);

    await db.insert(calendars).values({ ownerId: first, displayName: 'a', shareTokenHash: 'hash-1' });
    await expect(
      db.insert(calendars).values({ ownerId: second, displayName: 'b', shareTokenHash: 'hash-1' }),
    ).rejects.toThrow();
    await db.insert(calendars).values({ ownerId: second, displayName: 'b', shareTokenHash: null });
  });

  it('enforces the partial unique index on drafts only when a recognition job is set', async () => {
    const userId = await createUser(db);
    const [job] = await db
      .insert(recognitionJobs)
      .values({
        userId,
        status: RecognitionStatus.RECOGNIZED,
        sourceMime: 'image/png',
        expiresAt: FAR_FUTURE,
      })
      .returning();

    await db.insert(drafts).values(draftValues(userId, job!.id, 'row-1'));
    await expect(db.insert(drafts).values(draftValues(userId, job!.id, 'row-1'))).rejects.toThrow();
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
    await expect(
      db.insert(payments).values({ ...payment, providerPaymentKey: 'mock_success_1' }),
    ).rejects.toThrow();
    await db.insert(payments).values(payment);
    await db.insert(payments).values(payment);

    await db.insert(paymentEvents).values({ provider: PaymentProviderType.MOCK, eventKey: 'evt-1' });
    await expect(
      db.insert(paymentEvents).values({ provider: PaymentProviderType.MOCK, eventKey: 'evt-1' }),
    ).rejects.toThrow();
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

    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(entitlements)
          .values({ userId, yearMonth: '2027-02', source: EntitlementSource.TRIAL });
        await tx
          .insert(entitlements)
          .values({ userId, yearMonth: '2027-02', source: EntitlementSource.TRIAL });
      }),
    ).rejects.toThrow();

    const rows = await db.select().from(entitlements).where(eq(entitlements.userId, userId));

    expect(rows).toHaveLength(0);
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
