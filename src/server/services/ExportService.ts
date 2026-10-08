import 'server-only';

import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { buildIcsFileName } from '@/domain/ExportFileNames';
import { buildIcs } from '@/domain/IcsBuilder';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { track } from '@/server/analytics/Analytics';
import { getAppConfig } from '@/server/config/AppConfig';
import { buildStableUidBase } from '@/server/crypto/StableUid';
import { getPricing } from '@/server/config/PricingConfig';
import { type DbExecutor } from '@/server/db/Database';
import { ApiError } from '@/server/errors/ApiError';
import { type RequestContext } from '@/server/http/RequestContext';
import { findEffectiveMonth } from '@/server/services/EffectiveMonthService';
import { hasEntitlement } from '@/server/services/EntitlementService';
import { requireUser } from '@/server/validation/RequestGuards';

export type IcsExport = {
  fileName: string;
  body: string;
};

/** What ICS/PNG export needs from a month of the user's calendar. */
type ExportableMonth = {
  calendarId: string;
  displayName: string;
  yearMonth: string;
  definitions: ShiftDefinition[];
  entries: ShiftEntry[];
  updatedAt: Date;
  teamName: string | null;
};

/**
 * A month of the user's calendar they may export. Not in the calendar → 404. Personal months need a live
 * entitlement (a published month always has one: publish requires it and deletion keeps it), else 402. Team
 * months never use personal entitlements and are exportable while the membership is ACTIVE (Team spec §0).
 */
const requireExportableMonth = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<ExportableMonth> => {
  const { user } = requireUser(context);
  const month = await findEffectiveMonth(db, user.id, yearMonth);

  if (!month) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  if (month.source === CalendarMonthSource.TEAM) {
    return {
      // Stable per member and team (re-importing a changed team month updates the same events), without
      // putting internal IDs into a file members may forward.
      calendarId: buildStableUidBase(`team:${month.team.teamId}:${user.id}`),
      displayName: month.calendar?.displayName ?? user.displayName,
      yearMonth: month.yearMonth,
      definitions: month.team.definitions,
      entries: month.team.entries,
      updatedAt: month.team.publishedAt,
      teamName: month.team.teamName,
    };
  }

  if (!(await hasEntitlement(db, user.id, month.yearMonth))) {
    throw new ApiError(ApiErrorCode.PAYMENT_REQUIRED, {
      details: { yearMonth: month.yearMonth, priceKrw: getPricing(getAppConfig()).priceKrw },
    });
  }

  return {
    calendarId: month.calendar.id,
    displayName: month.calendar.displayName,
    yearMonth: month.yearMonth,
    definitions: month.month.definitions,
    entries: month.month.entries,
    updatedAt: month.month.updatedAt,
    teamName: null,
  };
};

/** GET /api/calendar/:ym/export.ics — one-time import file (not a subscription). Days off only on request. */
export const exportMonthIcs = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
  includeOff: boolean,
): Promise<IcsExport> => {
  const month = await requireExportableMonth(db, context, yearMonth);
  const body = buildIcs({
    calendarId: month.calendarId,
    displayName: month.displayName,
    yearMonth: month.yearMonth,
    entries: month.entries,
    definitions: month.definitions,
    includeOff,
    generatedAt: new Date(),
  });

  track(AnalyticsEvent.EXPORT_ICS, {
    actorUserId: requireUser(context).user.id,
    properties: { includeOff, team: month.teamName !== null },
  });

  return { fileName: buildIcsFileName(month.yearMonth), body };
};

/** GET /api/calendar/:ym/export-data — checked snapshot for the client PNG renderer. */
export const getExportData = async (
  db: DbExecutor,
  context: RequestContext,
  yearMonth: string,
): Promise<ExportDataResponse> => {
  const month = await requireExportableMonth(db, context, yearMonth);

  track(AnalyticsEvent.EXPORT_PNG, {
    actorUserId: requireUser(context).user.id,
    properties: { team: month.teamName !== null },
  });

  return {
    displayName: month.displayName,
    yearMonth: month.yearMonth,
    definitions: month.definitions,
    entries: month.entries,
    generatedAt: new Date().toISOString(),
    updatedAt: month.updatedAt.toISOString(),
    teamName: month.teamName,
  };
};
