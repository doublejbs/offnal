import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';
import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { jsonResponse } from '@/server/http/RouteHelpers';
import { setAnonymousCookie } from '@/server/http/SessionCookies';
import { enforceUploadLimits } from '@/server/services/RateLimitService';
import { createRecognitionJob } from '@/server/services/RecognitionProcessService';
import { validateUpload } from '@/server/services/UploadValidator';

export const runtime = 'nodejs';

/** Allowance for multipart boundaries and headers on top of the file size limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MISSING_FILE_MESSAGE = '사진 파일을 선택해 주세요.';

const readUploadedFile = async (request: NextRequest, maxBytes: number): Promise<Buffer> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);

  if (declaredLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: MISSING_FILE_MESSAGE });
  }

  const file = form.get('file');

  if (!(file instanceof File)) {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR, { message: MISSING_FILE_MESSAGE });
  }

  if (file.size > maxBytes) {
    throw new ApiError(ApiErrorCode.FILE_TOO_LARGE);
  }

  return Buffer.from(await file.arrayBuffer());
};

/**
 * multipart `file` → private source + `uploaded` job. Every attempt that reaches this point counts
 * toward the limits (before decoding), and the anonymous session is created only after the check.
 */
export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) => {
  const config = getAppConfig();
  const bytes = await readUploadedFile(request, config.uploadMaxBytes);
  const userId = context.user?.id ?? null;

  await enforceUploadLimits(db, {
    userId,
    anonymousSessionId: context.anonymousSessionId,
    ipHash: context.ipHash,
  });

  const upload = await validateUpload(bytes, {
    maxBytes: config.uploadMaxBytes,
    maxPixels: config.uploadMaxPixels,
  });
  const created = await createRecognitionJob(db, {
    userId,
    anonymousSessionId: context.anonymousSessionId,
    ipHash: context.ipHash,
    bytes,
    mime: upload.mime,
  });
  const response = jsonResponse({ id: created.id }, 201);

  if (created.issuedAnonymousSession) {
    setAnonymousCookie(response, created.issuedAnonymousSession);
  }

  return response;
});
