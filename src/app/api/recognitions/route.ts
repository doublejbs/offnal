import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { createAnonymousSession, type IssuedToken, setAnonymousCookie } from '@/server/auth/SessionService';
import { getAppConfig } from '@/server/config/AppConfig';
import { getDb } from '@/server/db/Database';
import { ApiError } from '@/server/http/ApiError';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, jsonResponse, withRoute } from '@/server/http/RouteHelpers';
import { enforceUploadLimits } from '@/server/services/RateLimitService';
import { createRecognitionJob } from '@/server/services/RecognitionService';
import { validateUpload } from '@/server/services/UploadValidator';

export const runtime = 'nodejs';

/** Allowance for multipart boundaries and headers on top of the file size limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const readUploadedFile = async (request: NextRequest, maxBytes: number): Promise<Buffer> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);

  if (declaredLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: '사진 파일을 선택해 주세요.' });
  }

  const file = form.get('file');

  if (!(file instanceof File)) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: '사진 파일을 선택해 주세요.' });
  }

  if (file.size > maxBytes) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  return Buffer.from(await file.arrayBuffer());
};

/** multipart `file` → private source + `uploaded` job. Issues `offnal_anon` for first-time visitors. */
export const POST = withRoute(async (request: NextRequest) => {
  assertSameOrigin(request);

  const config = getAppConfig();
  const bytes = await readUploadedFile(request, config.uploadMaxBytes);
  const upload = await validateUpload(bytes, {
    maxBytes: config.uploadMaxBytes,
    maxPixels: config.uploadMaxPixels,
  });
  const db = await getDb();
  const context = await getRequestContext(request, db);
  const userId = context.user?.id ?? null;
  let issuedAnonymous: IssuedToken | null = null;
  let anonymousSessionId = context.anonymousSessionId;

  if (!userId && !anonymousSessionId) {
    issuedAnonymous = await createAnonymousSession(db, context.ipHash);
    anonymousSessionId = issuedAnonymous.id;
  }

  await enforceUploadLimits(db, { userId, anonymousSessionId, ipHash: context.ipHash });

  const created = await createRecognitionJob(db, { userId, anonymousSessionId, bytes, mime: upload.mime });
  const response = jsonResponse(created, 201);

  if (issuedAnonymous) {
    setAnonymousCookie(response, issuedAnonymous);
  }

  return response;
});
