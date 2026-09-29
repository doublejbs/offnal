import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { buildIcs } from '@/domain/IcsBuilder';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { getPricing } from '@/server/config/PricingConfig';
import { type DbExecutor } from '@/server/db/Database';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { findOwnedPublishedMonth, type OwnedPublishedMonth } from '@/server/services/CalendarService';
import { hasEntitlement } from '@/server/services/EntitlementService';
import { requireUser } from '@/server/validation/RequestGuards';

export type IcsExport = {
  fileName: string;
  body: string;
};

/**
 * Owner's published month with a live entitlement. Not owned / not published → 404. A published month
 * always has one (publish requires it, deletion keeps it), so a missing entitlement is 402.
 */
const requireExportableMonth = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<OwnedPublishedMonth> => {
  const { user } = requireUser(context);
  const owned = await findOwnedPublishedMonth(db, user.id, yearMonth);

  if (!owned) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  if (!(await hasEntitlement(db, user.id, owned.month.yearMonth))) {
    throw new ApiError(ApiErrorCode.PAYMENT_REQUIRED, {
      details: { yearMonth: owned.month.yearMonth, priceKrw: getPricing(getAppConfig()).priceKrw },
    });
  }

  return owned;
};

/** GET /api/calendar/:ym/export.ics — one-time import file (not a subscription). Days off only on request. */
export const exportMonthIcs = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
  includeOff: boolean,
): Promise<IcsExport> => {
  const { calendar, month } = await requireExportableMonth(db, context, yearMonth);
  const body = buildIcs({
    calendarId: calendar.id,
    displayName: calendar.displayName,
    yearMonth: month.yearMonth,
    entries: month.entries,
    definitions: month.definitions,
    includeOff,
    generatedAt: new Date(),
  });

  track(AnalyticsEvent.EXPORT_ICS, { includeOff });

  return { fileName: `offnal-${month.yearMonth}.ics`, body };
};

/** GET /api/calendar/:ym/export-data — entitlement-checked snapshot for the client PNG renderer. */
export const getExportData = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<ExportDataResponse> => {
  const { calendar, month } = await requireExportableMonth(db, context, yearMonth);

  track(AnalyticsEvent.EXPORT_PNG);

  return {
    displayName: calendar.displayName,
    yearMonth: month.yearMonth,
    definitions: month.definitions,
    entries: month.entries,
    generatedAt: new Date().toISOString(),
    updatedAt: month.updatedAt.toISOString(),
  };
};
