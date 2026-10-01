import { getAppConfig } from '@/server/config/AppConfig';
import { apiRoute, type NoParams } from '@/server/http/ApiRoute';
import { jsonResponse } from '@/server/http/RouteHelpers';
import { setAnonymousCookie } from '@/server/http/SessionCookies';
import { readUploadedForm } from '@/server/http/UploadForm';
import { enforceUploadLimits } from '@/server/services/RateLimitService';
import { createRecognitionJob } from '@/server/services/RecognitionProcessService';
import { validateUpload } from '@/server/services/UploadValidator';

export const runtime = 'nodejs';

/**
 * multipart `file` → private source + `uploaded` job. Every attempt that reaches this point counts
 * toward the limits (before decoding), and the anonymous session is created only after the check.
 */
export const POST = apiRoute<NoParams>({ mutating: true }, async ({ request, db, context }) => {
  const config = getAppConfig();
  const { bytes } = await readUploadedForm(request, config.uploadMaxBytes);
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
