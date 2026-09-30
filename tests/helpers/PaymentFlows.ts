import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { POST as confirmPaymentRoute } from '@/app/api/payments/confirm/route';
import { POST as createPaymentRoute } from '@/app/api/payments/route';
import { POST as webhookRoute } from '@/app/api/payments/webhook/route';
import { PaymentClientMode } from '@/domain/enums/PaymentClientMode';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { type CreatePaymentResponse } from '@/domain/types/api/CreatePaymentResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { type Db } from '@/server/db/Database';
import { users } from '@/server/db/Schema';
import { type PaymentProvider, type ProviderPaymentResult } from '@/server/payment/PaymentProvider';
import { type ApiTestClient, readJson } from './ApiTestClient';
import { createLoggedInJob, createReadyDraft, publishDraft } from './OffnalFlows';

const unusedResult = async (): Promise<ProviderPaymentResult> => ({
  ok: false,
  code: 'UNUSED',
  message: '',
  transient: false,
});

/** Fake provider (kind mock, so it matches orders created in demo mode); unset methods fail permanently. */
export const buildFakeProvider = (overrides: Partial<PaymentProvider>): PaymentProvider => ({
  kind: PaymentProviderType.MOCK,
  getClientConfig: () => ({ clientKey: null, mode: PaymentClientMode.MOCK }),
  confirm: unusedResult,
  fetchPayment: unusedResult,
  fetchPaymentByOrderId: unusedResult,
  ...overrides,
});

export const buildMockSuccessKey = (): string => `mock_success_${randomUUID()}`;

export const buildMockFailKey = (): string => `mock_fail_${randomUUID()}`;

export const publishReady = async (client: ApiTestClient, draft: DraftResponse): Promise<Response> =>
  publishDraft(client, draft.draft.id, draft.draft.revision);

export const findUserId = async (db: Db, displayName: string): Promise<string> => {
  const [user] = await db.select().from(users).where(eq(users.displayName, displayName));

  if (!user) {
    throw new Error(`user not found: ${displayName}`);
  }

  return user.id;
};

export const requestPayment = async (
  client: ApiTestClient,
  body: { yearMonth: string; draftId?: string },
): Promise<Response> => client.send(createPaymentRoute, '/api/payments', { json: body });

export const createPayment = async (
  client: ApiTestClient,
  body: { yearMonth: string; draftId?: string },
): Promise<CreatePaymentResponse> => {
  const response = await requestPayment(client, body);

  expect(response.status).toBe(200);

  return readJson<CreatePaymentResponse>(response);
};

export const confirmPayment = async (
  client: ApiTestClient,
  body: { orderId: string; paymentKey: string; amount: number },
): Promise<Response> => client.send(confirmPaymentRoute, '/api/payments/confirm', { json: body });

export const sendWebhook = async (client: ApiTestClient, body: unknown): Promise<Response> =>
  client.send(webhookRoute, '/api/payments/webhook', { json: body, origin: null });

export type TrialsUsedSetup = {
  jobId: string;
  userId: string;
  /** Ready (unblocked) editing draft for `paidMonth`, which needs payment. */
  paidDraft: DraftResponse;
};

/**
 * Logs in, publishes two free months and prepares a ready draft for a third month (402 on publish).
 * Every month is extracted up front because publishing deletes the source photo.
 */
export const setupTrialsUsed = async (
  db: Db,
  client: ApiTestClient,
  displayName: string,
  months: [string, string, string],
): Promise<TrialsUsedSetup> => {
  const jobId = await createLoggedInJob(client, displayName);
  const first = await createReadyDraft(client, jobId, months[0]);
  const second = await createReadyDraft(client, jobId, months[1]);
  const paidDraft = await createReadyDraft(client, jobId, months[2]);

  expect((await publishReady(client, first)).status).toBe(200);
  expect((await publishReady(client, second)).status).toBe(200);

  return { jobId, userId: await findUserId(db, displayName), paidDraft };
};
