import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { deletePublishedMonth, getPublishedMonth } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

export const GET = apiRoute<YearMonthParams>({ mutating: false }, async ({ db, context, params }) =>
  getPublishedMonth(db, context, params.yearMonth),
);

export const DELETE = apiRoute<YearMonthParams>({ mutating: true }, async ({ db, context, params }) =>
  deletePublishedMonth(db, context, params.yearMonth),
);
