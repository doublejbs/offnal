import 'server-only';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { track } from '@/server/analytics/Analytics';
import { type RequestContext } from '@/server/http/RequestContext';

/** Query flag only the month screen sends: other reads of the same API (checkout, export sheet) are not views. */
const CALENDAR_VIEW_PARAM = 'view';
const CALENDAR_VIEW_VALUE = '1';

type ViewRequest = { nextUrl: URL };

/**
 * `calendar_viewed` (Spec §23.3): `GET /api/calendar/:ym?view=1` from the "내 달력" month screen, after a
 * successful read. Day-level return visits are counted from it.
 */
export const trackCalendarViewed = (request: ViewRequest, context: RequestContext): void => {
  if (!context.user || request.nextUrl.searchParams.get(CALENDAR_VIEW_PARAM) !== CALENDAR_VIEW_VALUE) {
    return;
  }

  track(AnalyticsEvent.CALENDAR_VIEWED, { actorUserId: context.user.id });
};
