import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { parseJsonBody } from '@/server/http/RouteHelpers';
import { createPayment } from '@/server/services/PaymentService';
import { createPaymentRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) =>
  createPayment(db, context, await parseJsonBody(request, createPaymentRequestSchema)),
);
