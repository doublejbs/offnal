import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { POST as editMonthRoute } from '@/app/api/calendar/[yearMonth]/edit/route';
import { GET as exportIcsRoute } from '@/app/api/calendar/[yearMonth]/export.ics/route';
import { GET as calendarRoute } from '@/app/api/calendar/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { EntitlementSource } from '@/domain/enums/EntitlementSource';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type EditPublishedMonthResponse } from '@/domain/types/api/EditPublishedMonthResponse';
import { type PublishDraftResponse } from '@/domain/types/api/PublishDraftResponse';
import { entitlements, payments } from '@/server/db/Schema';
import { setPaymentProviderForTesting } from '@/server/payment/PaymentFactory';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import {
  createLoggedInJob,
  createReadyDraft,
  defineMockUndefinedCodes,
  extractRow,
  patchDraft,
  readDraft,
  resolveEntries,
} from '../helpers/OffnalFlows';
import { confirmPayment, findUserId, publishReady, requestPayment, sendWebhook } from '../helpers/PaymentFlows';

const SECOND_ROW_ID = 'r2';

let env: IntegrationEnvironment;
const envSandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  setPaymentProviderForTesting(null);
  envSandbox.restore();
});

afterAll(async () => {
  await env.close();
});

const enableBetaFree = (): void => {
  envSandbox.set({ BILLING_MODE: 'beta_free' });
};

const countEntitlements = async (userId: string, source: EntitlementSource): Promise<number> => {
  const rows = await env.db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.source, source)));

  return rows.length;
};

const countMonthEntitlements = async (userId: string, yearMonth: string): Promise<number> => {
  const rows = await env.db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), eq(entitlements.yearMonth, yearMonth)));

  return rows.length;
};

/** A second ready draft of the same month (another row of the same photo). */
const createSecondRowDraft = async (
  client: ApiTestClient,
  jobId: string,
  yearMonth: string,
): Promise<DraftResponse> => {
  const draftId = await extractRow(client, jobId, yearMonth, SECOND_ROW_ID);
  const current = await readDraft(client, draftId);
  const response = await patchDraft(client, draftId, {
    revision: current.draft.revision,
    entries: resolveEntries(current.draft.entries),
    definitions: defineMockUndefinedCodes(current.draft.definitions),
  });

  expect(response.status).toBe(200);

  return readJson<DraftResponse>(response);
};

const exportIcs = (client: ApiTestClient, yearMonth: string): Promise<Response> =>
  client.send(exportIcsRoute, `/api/calendar/${yearMonth}/export.ics`, { params: { yearMonth } });

const expectNotFound = async (response: Response): Promise<void> => {
  const body = await readJson<ApiErrorBody>(response);

  expect(response.status).toBe(404);
  expect(body.error.code).toBe(ApiErrorCode.NOT_FOUND);
};

describe('beta free publish', () => {
  it('publishes any number of months without trials, one beta entitlement per month', async () => {
    enableBetaFree();

    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '베타 사용자');
    const userId = await findUserId(env.db, '베타 사용자');
    // Publishing deletes the source photo, so extract every month up front.
    const months = ['2027-01', '2027-02', '2027-03', '2027-04'];
    const ready: DraftResponse[] = [];

    for (const month of months) {
      ready.push(await createReadyDraft(client, jobId, month));
    }

    const sameMonthDraft = await createSecondRowDraft(client, jobId, '2027-01');
    const unpublished = await createReadyDraft(client, jobId, '2027-05');

    expect(unpublished.access.monthAccess).toBe(MonthAccess.BETA_FREE);

    for (const draft of ready) {
      const response = await publishReady(client, draft);

      expect(response.status).toBe(200);
      expect(await readJson<PublishDraftResponse>(response)).toMatchObject({
        usedTrial: false,
        alreadyPublished: false,
      });
    }

    const republish = await publishReady(client, sameMonthDraft);

    expect(republish.status).toBe(200);
    expect(await readJson<PublishDraftResponse>(republish)).toMatchObject({ usedTrial: false });
    expect(await countMonthEntitlements(userId, '2027-01')).toBe(1);
    expect(await countEntitlements(userId, EntitlementSource.TRIAL)).toBe(0);
    expect(await countEntitlements(userId, EntitlementSource.BETA)).toBe(months.length);

    const thirdMonthIcs = await exportIcs(client, '2027-03');

    expect(thirdMonthIcs.status).toBe(200);
    expect(await thirdMonthIcs.text()).toContain('BEGIN:VCALENDAR');
  });

  // On PGlite (one connection) these transactions are serialized anyway; `FOR UPDATE` on the user row and
  // unique(user_id, year_month) guarantee this on real Postgres — run `pnpm test:pg` to verify.
  it('keeps one entitlement row when the same month is published concurrently', async () => {
    enableBetaFree();

    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '베타 동시 사용자');
    const userId = await findUserId(env.db, '베타 동시 사용자');
    const first = await createReadyDraft(client, jobId, '2027-06');
    const second = await createSecondRowDraft(client, jobId, '2027-06');
    const responses = await Promise.all([publishReady(client, first), publishReady(client, second)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await countMonthEntitlements(userId, '2027-06')).toBe(1);
    expect(await countEntitlements(userId, EntitlementSource.TRIAL)).toBe(0);
  });
});

describe('beta free payment routes', () => {
  it('returns 404 for create, confirm and webhook without touching payments', async () => {
    enableBetaFree();

    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '베타 결제 사용자');
    const userId = await findUserId(env.db, '베타 결제 사용자');
    const draft = await createReadyDraft(client, jobId, '2027-07');

    await expectNotFound(await requestPayment(client, { yearMonth: '2027-07', draftId: draft.draft.id }));
    await expectNotFound(
      await confirmPayment(client, {
        orderId: '00000000-0000-4000-8000-000000000000',
        paymentKey: 'mock_success_x',
        amount: 990,
      }),
    );
    await expectNotFound(
      await sendWebhook(client, {
        eventType: 'PAYMENT_STATUS_CHANGED',
        data: { paymentKey: 'pk', orderId: '00000000-0000-4000-8000-000000000000', status: 'DONE' },
      }),
    );

    const rows = await env.db.select().from(payments).where(eq(payments.userId, userId));

    expect(rows).toHaveLength(0);
  });

  it('returns 404 before building the payment provider (Toss without keys)', async () => {
    const client = createApiTestClient();

    await createLoggedInJob(client, '베타 토스 사용자');

    envSandbox.set({
      BILLING_MODE: 'beta_free',
      PAYMENT_PROVIDER: 'toss',
      TOSS_CLIENT_KEY: undefined,
      TOSS_SECRET_KEY: undefined,
    });

    await expectNotFound(await requestPayment(client, { yearMonth: '2027-08' }));
    await expectNotFound(
      await confirmPayment(client, {
        orderId: '00000000-0000-4000-8000-000000000000',
        paymentKey: 'pk',
        amount: 990,
      }),
    );
    await expectNotFound(await sendWebhook(client, { orderId: 'x' }));
  });
});

describe('switching back to paid', () => {
  it('keeps beta months open and leaves both free months', async () => {
    enableBetaFree();

    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '베타 전환 사용자');
    const months = ['2027-09', '2027-10', '2027-11'];
    const ready: DraftResponse[] = [];

    for (const month of months) {
      ready.push(await createReadyDraft(client, jobId, month));
    }

    for (const draft of ready) {
      expect((await publishReady(client, draft)).status).toBe(200);
    }

    envSandbox.restore();

    const summary = await readJson<CalendarSummaryResponse>(await client.send(calendarRoute, '/api/calendar'));

    expect(summary.freeRemaining).toBe(2);

    for (const month of months) {
      const editResponse = await client.send(editMonthRoute, `/api/calendar/${month}/edit`, {
        method: 'POST',
        params: { yearMonth: month },
      });
      const { draftId } = await readJson<EditPublishedMonthResponse>(editResponse);
      const editDraft = await readDraft(client, draftId);

      expect(editDraft.access).toMatchObject({ monthAccess: MonthAccess.EXISTING, freeRemaining: 2 });
      expect((await exportIcs(client, month)).status).toBe(200);
    }

    const payment = await requestPayment(client, { yearMonth: '2027-09' });

    expect(payment.status).toBe(409);
    expect((await readJson<ApiErrorBody>(payment)).error.code).toBe(ApiErrorCode.ALREADY_ENTITLED);
  });
});
