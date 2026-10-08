import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { assertPaymentsEnabled } from '@/server/services/PaymentGuard';
import { confirmPayment } from '@/server/services/PaymentService';
import { confirmPaymentRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) => {
  // Before the body is parsed: in beta free mode the route does not exist (Spec §20.3).
  assertPaymentsEnabled();

  return confirmPayment(db, context, await parseJsonBody(request, confirmPaymentRequestSchema));
});
