import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { confirmPayment } from '@/server/services/PaymentService';
import { confirmPaymentRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) =>
  confirmPayment(db, context, await parseJsonBody(request, confirmPaymentRequestSchema)),
);
