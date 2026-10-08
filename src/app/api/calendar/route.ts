import { trackCalendarViewed } from '@/server/analytics/CalendarViewTracking';
import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { getCalendarSummary } from '@/server/services/CalendarService';

export const runtime = 'nodejs';

export const GET = apiRoute<NoParams>({ mutating: false }, async ({ db, context }) => {
  const summary = await getCalendarSummary(db, context);

  trackCalendarViewed(context);

  return summary;
});
