import { trackCalendarViewed } from '@/server/analytics/CalendarViewTracking';
import { apiRoute, type YearMonthParams } from '@/server/http/ApiRoute';
import { deletePublishedMonth, getPublishedMonth } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

export const GET = apiRoute<YearMonthParams>({ mutating: false }, async ({ db, context, params }) => {
  const month = await getPublishedMonth(db, context, params.yearMonth);

  trackCalendarViewed(context);

  return month;
});

export const DELETE = apiRoute<YearMonthParams>({ mutating: true }, async ({ db, context, params }) =>
  deletePublishedMonth(db, context, params.yearMonth),
);
