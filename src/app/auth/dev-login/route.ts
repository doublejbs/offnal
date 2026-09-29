import { type NextRequest } from 'next/server';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type DevLoginRequest } from '@/domain/types/api/DevLoginRequest';
import { getDevAuthProvider, isDevLoginEnabled } from '@/server/auth/AuthProviderRegistry';
import { completeLogin } from '@/server/auth/LoginService';
import { getDb } from '@/server/db/Database';
import { ApiError } from '@/server/http/ApiError';
import { getRequestContext } from '@/server/http/RequestContext';
import { assertSameOrigin, sanitizeReturnTo, withRoute } from '@/server/http/RouteHelpers';
import { devLoginRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

const readFormValue = (form: FormData, key: string): string | undefined => {
  const value = form.get(key);

  return typeof value === 'string' ? value : undefined;
};

const readBody = async (request: NextRequest): Promise<DevLoginRequest> => {
  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      return devLoginRequestSchema.parse(await request.json());
    }

    const form = await request.formData();

    return devLoginRequestSchema.parse({
      displayName: readFormValue(form, 'displayName'),
      returnTo: readFormValue(form, 'returnTo'),
    });
  } catch {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR);
  }
};

/** Demo-only instant login (JSON or form). Same completion as the OAuth callback; 303 to `returnTo`. */
export const POST = withRoute(async (request: NextRequest) => {
  if (!isDevLoginEnabled()) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  assertSameOrigin(request);

  const body = await readBody(request);
  const profile = getDevAuthProvider().createProfile(body.displayName ?? '');
  const db = await getDb();
  const context = await getRequestContext(request, db);

  return completeLogin(db, context, profile, sanitizeReturnTo(body.returnTo), 303);
});
