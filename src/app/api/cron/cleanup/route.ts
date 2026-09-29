import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { getAppConfig } from '@/server/config/AppConfig';
import { isEqualConstantTime } from '@/server/crypto/TokenCrypto';
import { getDb } from '@/server/db/Database';
import { ApiError } from '@/server/errors/ApiError';
import { jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { runCleanup } from '@/server/services/CleanupService';
import { getObjectStorage } from '@/server/storage/StorageFactory';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BEARER_PREFIX = 'Bearer ';

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set. */
const assertCronAuthorized = (request: NextRequest): void => {
  const secret = getAppConfig().cronSecret;

  if (!secret) {
    throw new ApiError(ApiErrorCode.PROVIDER_NOT_CONFIGURED, { message: 'CRON_SECRET이 설정되지 않았어요.' });
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';

  if (!isEqualConstantTime(provided, secret)) {
    throw new ApiError(ApiErrorCode.AUTH_REQUIRED, { message: '인증되지 않은 요청이에요.' });
  }
};

/** GET /api/cron/cleanup (hourly, vercel.json). Returns per-step counts. */
export const GET = withRoute(async (request: NextRequest) => {
  assertCronAuthorized(request);

  return jsonResponse(await runCleanup(await getDb(), getObjectStorage()));
});
