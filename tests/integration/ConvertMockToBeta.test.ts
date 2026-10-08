import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { PaymentStatus } from '@/domain/enums/PaymentStatus';
import { RosterRowExtractStatus } from '@/domain/enums/RosterRowExtractStatus';
import { TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { TeamRole } from '@/domain/enums/TeamRole';
import { TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';
import { type Db } from '@/server/db/Database';
import { countMockPaymentData } from '@/server/db/DatabaseInspection';
import {
  calendars,
  entitlements,
  paymentEvents,
  payments,
  publishedMonths,
  teamMembers,
  teamRosterRows,
  teamRosters,
  teams,
  users,
} from '@/server/db/Schema';
import { type IntegrationEnvironment, setupIntegrationEnvironment } from '../helpers/ApiTestClient';

const SQL_PATH = path.join(process.cwd(), 'docs/sql/ConvertMockToBeta.sql');
const TEAM_ROW_KEY = '팀원:1';
const TRANSACTION_CONTROL = /^(begin|commit)$/i;

let env: IntegrationEnvironment;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterAll(async () => {
  await env.close();
});

/** Statements of the SQL file without comments (the file has only full-line `--` comments and no `;` in strings). */
const readStatements = async (): Promise<string[]> => {
  const raw = await readFile(SQL_PATH, 'utf8');
  const body = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return body
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
};

/**
 * Runs the file as the SQL Editor would. `execute` sends one statement at a time, and on node-postgres
 * (`pnpm test:pg`) a bare BEGIN/COMMIT could land on different pool connections, so the file's own
 * BEGIN/COMMIT are replaced by a drizzle transaction here (test only). Returns the final verification row.
 */
const runConversion = async (db: Db): Promise<Record<string, unknown>> => {
  const statements = (await readStatements()).filter((statement) => !TRANSACTION_CONTROL.test(statement));

  return db.transaction(async (tx) => {
    let lastRows: unknown[] = [];

    for (const statement of statements) {
      const result = await tx.execute(sql.raw(statement));

      lastRows = (result as { rows?: unknown[] }).rows ?? [];
    }

    return (lastRows[0] ?? {}) as Record<string, unknown>;
  });
};

const createUser = async (displayName: string): Promise<string> => {
  const [user] = await env.db.insert(users).values({ displayName }).returning({ id: users.id });

  return user!.id;
};

const publishMonth = async (ownerId: string, displayName: string, months: string[]): Promise<void> => {
  const [calendar] = await env.db.insert(calendars).values({ ownerId, displayName }).returning();

  for (const yearMonth of months) {
    await env.db.insert(publishedMonths).values({ calendarId: calendar!.id, yearMonth, definitions: [], entries: [] });
  }
};

const seedTeamMonth = async (userId: string, yearMonth: string): Promise<void> => {
  const [team] = await env.db.insert(teams).values({ name: '병동 팀', createdBy: userId }).returning();

  await env.db.insert(teamMembers).values({
    teamId: team!.id,
    userId,
    role: TeamRole.MEMBER,
    status: TeamMemberStatus.ACTIVE,
    linkedRowKey: TEAM_ROW_KEY,
  });

  const [roster] = await env.db
    .insert(teamRosters)
    .values({ teamId: team!.id, yearMonth, status: TeamRosterStatus.PUBLISHED, revision: 1, publishedAt: new Date() })
    .returning();

  await env.db.insert(teamRosterRows).values({
    rosterId: roster!.id,
    rowKey: TEAM_ROW_KEY,
    displayName: '팀원',
    position: 0,
    entries: [],
    extractStatus: RosterRowExtractStatus.MANUAL,
  });
};

const listEntitlements = async (userId: string) =>
  env.db
    .select({
      yearMonth: entitlements.yearMonth,
      source: entitlements.source,
      paymentId: entitlements.paymentId,
    })
    .from(entitlements)
    .where(eq(entitlements.userId, userId))
    .orderBy(entitlements.yearMonth);

const snapshotTables = async () => ({
  entitlements: await env.db
    .select()
    .from(entitlements)
    .orderBy(entitlements.userId, entitlements.yearMonth),
  payments: await env.db.select().from(payments).orderBy(payments.id),
  paymentEvents: await env.db.select().from(paymentEvents).orderBy(paymentEvents.id),
});

describe('docs/sql/ConvertMockToBeta.sql', () => {
  it('keeps BEGIN/COMMIT around every change so the SQL Editor runs it as one transaction', async () => {
    const statements = await readStatements();
    const controls = statements.filter((statement) => TRANSACTION_CONTROL.test(statement));

    expect(controls.map((statement) => statement.toLowerCase())).toEqual(['begin', 'commit']);
    expect(statements[0]?.toLowerCase()).toBe('begin');
    // Only the read-only verification query follows the COMMIT.
    expect(statements.at(-2)?.toLowerCase()).toBe('commit');
    expect(statements.at(-1)?.toLowerCase().startsWith('select')).toBe(true);
  });

  it('converts trial and mock purchases to beta, backfills published months and removes mock payments', async () => {
    const trialUser = await createUser('trial 사용자');
    const mockBuyer = await createUser('mock 결제 사용자');
    const tossBuyer = await createUser('토스 결제 사용자');

    await publishMonth(trialUser, 'trial 사용자', ['2026-08', '2026-09', '2026-10']);
    await publishMonth(mockBuyer, 'mock 결제 사용자', ['2026-11']);
    await publishMonth(tossBuyer, '토스 결제 사용자', ['2026-12']);
    // Team months never use personal entitlements: a member with only a team month must get none.
    await seedTeamMonth(trialUser, '2027-01');

    await env.db.insert(entitlements).values([
      { userId: trialUser, yearMonth: '2026-08', source: EntitlementSource.TRIAL },
      { userId: trialUser, yearMonth: '2026-09', source: EntitlementSource.TRIAL },
      // A trial month that was later deleted from the calendar keeps its entitlement.
      { userId: mockBuyer, yearMonth: '2026-07', source: EntitlementSource.TRIAL },
    ]);

    const [mockPayment] = await env.db
      .insert(payments)
      .values({
        userId: mockBuyer,
        yearMonth: '2026-11',
        amount: 990,
        provider: PaymentProviderType.MOCK,
        providerPaymentKey: 'mock_success_convert',
        status: PaymentStatus.PAID,
        confirmedAt: new Date(),
      })
      .returning();
    const [tossPayment] = await env.db
      .insert(payments)
      .values({
        userId: tossBuyer,
        yearMonth: '2026-12',
        amount: 990,
        provider: PaymentProviderType.TOSS,
        providerPaymentKey: 'toss_convert',
        status: PaymentStatus.PAID,
        confirmedAt: new Date(),
      })
      .returning();

    await env.db.insert(entitlements).values([
      { userId: mockBuyer, yearMonth: '2026-11', source: EntitlementSource.PURCHASE, paymentId: mockPayment!.id },
      { userId: tossBuyer, yearMonth: '2026-12', source: EntitlementSource.PURCHASE, paymentId: tossPayment!.id },
    ]);
    await env.db.insert(paymentEvents).values([
      { provider: PaymentProviderType.MOCK, eventKey: 'mock_event_1' },
      { provider: PaymentProviderType.TOSS, eventKey: 'toss_event_1' },
    ]);

    expect(await countMockPaymentData(env.db)).toEqual({ payments: 1, entitlements: 1 });

    const verification = await runConversion(env.db);

    expect(await listEntitlements(trialUser)).toEqual([
      { yearMonth: '2026-08', source: EntitlementSource.BETA, paymentId: null },
      { yearMonth: '2026-09', source: EntitlementSource.BETA, paymentId: null },
      // Backfilled: published without an entitlement.
      { yearMonth: '2026-10', source: EntitlementSource.BETA, paymentId: null },
    ]);
    expect(await listEntitlements(mockBuyer)).toEqual([
      { yearMonth: '2026-07', source: EntitlementSource.BETA, paymentId: null },
      { yearMonth: '2026-11', source: EntitlementSource.BETA, paymentId: null },
    ]);
    // Real (Toss) payments and their entitlements are untouched.
    expect(await listEntitlements(tossBuyer)).toEqual([
      { yearMonth: '2026-12', source: EntitlementSource.PURCHASE, paymentId: tossPayment!.id },
    ]);

    const remainingPayments = await env.db.select().from(payments);
    const remainingEvents = await env.db.select().from(paymentEvents);

    expect(remainingPayments.map((payment) => payment.id)).toEqual([tossPayment!.id]);
    expect(remainingEvents.map((event) => event.eventKey)).toEqual(['toss_event_1']);
    expect(await countMockPaymentData(env.db)).toEqual({ payments: 0, entitlements: 0 });
    expect(Object.fromEntries(Object.entries(verification).map(([key, value]) => [key, Number(value)]))).toEqual({
      trial_entitlements: 0,
      beta_entitlements: 5,
      mock_payments: 0,
      mock_payment_events: 0,
      months_without_entitlement: 0,
    });

    // Re-running changes nothing.
    const before = await snapshotTables();

    await runConversion(env.db);

    expect(await snapshotTables()).toEqual(before);
  });
});
