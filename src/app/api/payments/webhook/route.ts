import { type NextRequest } from 'next/server';

import { hashIp } from '@/server/auth/SessionService';
import { getDb } from '@/server/db/Database';
import { getClientIpFromHeaders } from '@/server/http/ClientIp';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { assertPaymentsEnabled } from '@/server/services/PaymentGuard';
import { handlePaymentWebhook } from '@/server/services/PaymentWebhookService';
import { enforceWebhookLimit } from '@/server/services/RateLimitService';

export const runtime = 'nodejs';

const readBody = async (request: NextRequest): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

/**
 * Provider → server (no Origin check, no cookies). The payload is only a hint: the payment is
 * re-fetched from the provider before anything is granted. 200 for unknown/duplicate events;
 * 5xx only for transient provider errors so the provider retries; 429 above the per-IP limit.
 * 404 in beta free mode, before the rate limit or the provider (Spec §20.3).
 */
export const POST = withRoute(async (request: NextRequest) => {
  assertPaymentsEnabled();

  const db = await getDb();

  await enforceWebhookLimit(db, hashIp(getClientIpFromHeaders(request.headers)));

  return jsonResponse(await handlePaymentWebhook(db, await readBody(request), request.headers));
});
