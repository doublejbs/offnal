import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { assertPaymentsEnabled } from '@/server/services/PaymentGuard';
import { createPayment } from '@/server/services/PaymentService';
import { createPaymentRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) => {
  // Before the body is parsed: in beta free mode the route does not exist (Spec §20.3).
  assertPaymentsEnabled();

  return createPayment(db, context, await parseJsonBody(request, createPaymentRequestSchema));
});
