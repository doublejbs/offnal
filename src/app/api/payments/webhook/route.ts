import { type NextRequest } from 'next/server';

import { getDb } from '@/server/db/Database';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { handlePaymentWebhook } from '@/server/services/PaymentService';

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
 * 5xx only for transient provider errors so the provider retries.
 */
export const POST = withRoute(async (request: NextRequest) =>
  jsonResponse(await handlePaymentWebhook(await getDb(), await readBody(request), request.headers)),
);
