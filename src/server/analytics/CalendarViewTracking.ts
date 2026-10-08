import 'server-only';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { track } from '@/server/analytics/Analytics';
import { type RequestContext } from '@/server/http/RequestContext';

/**
 * `calendar_viewed` (Spec §23.3) for the calendar API the "내 달력" screens load (`GET /api/calendar`,
 * `GET /api/calendar/:ym`), after a successful read. Day-level return visits are counted from it.
 */
export const trackCalendarViewed = (context: RequestContext): void => {
  if (!context.user) {
    return;
  }

  track(AnalyticsEvent.CALENDAR_VIEWED, { actorUserId: context.user.id });
};
