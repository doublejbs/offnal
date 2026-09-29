import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { createEditDraftFromPublished } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

export const POST = apiRoute<YearMonthParams>({ mutating: true }, async ({ db, context, params }) =>
  createEditDraftFromPublished(db, context, params.yearMonth),
);
