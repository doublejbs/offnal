import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { getCalendarSummary } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

export const GET = apiRoute<NoParams>({ mutating: false }, async ({ db, context }) =>
  getCalendarSummary(db, context),
);
