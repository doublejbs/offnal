import { NextResponse } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { SharedIcsNotice } from '@/domain/enums/SharedIcsNotice';
import { isValidYearMonth } from '@/domain/YearMonth';
import { ApiError } from '@/server/errors/ApiError';
import { buildAppUrl } from '@/server/http/RouteHelpers';

const NOTICE_BY_ERROR_CODE: Partial<Record<ApiErrorCode, SharedIcsNotice>> = {
  [ApiErrorCode.NOT_FOUND]: SharedIcsNotice.EXPIRED,
  [ApiErrorCode.RATE_LIMITED]: SharedIcsNotice.RATE_LIMITED,
};

/** Notice for a failed shared ICS open, or null when the failure stays a JSON error. */
export const toSharedIcsNotice = (error: unknown): SharedIcsNotice | null =>
  error instanceof ApiError ? (NOTICE_BY_ERROR_CODE[error.code] ?? null) : null;

/**
 * iOS opens shared ICS files by navigating (open=1), so a JSON error would be shown raw. Send the
 * browser back to the shared page instead: `/s/:token?month=…&ics=<notice>` (month only if valid).
 */
export const buildSharedIcsFailureRedirect = (
  token: string,
  month: string | null,
  notice: SharedIcsNotice,
): NextResponse => {
  const url = buildAppUrl(`/s/${encodeURIComponent(token)}`);

  if (month && isValidYearMonth(month)) {
    url.searchParams.set('month', month);
  }

  url.searchParams.set('ics', notice);

  return NextResponse.redirect(url, 303);
};
