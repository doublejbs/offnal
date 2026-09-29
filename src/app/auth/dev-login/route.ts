import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { getDevAuthProvider, isDevLoginEnabled } from '@/server/auth/AuthProviderRegistry';
import { completeLogin } from '@/server/auth/LoginService';
import { getDb } from '@/server/db/Database';
import { ApiError } from '@/server/errors/ApiError';
import { buildLoginRedirect } from '@/server/http/LoginResponses';
import { getRequestContext } from '@/server/http/RequestContext';
import {
  assertSameOrigin,
  buildLoginFailedRedirect,
  logUnexpectedError,
  NO_STORE,
  sanitizeReturnTo,
} from '@/server/http/RouteHelpers';
import { devLoginRequestSchema } from '@/server/services/RequestSchemas';

export const runtime = 'nodejs';

const rawBodySchema = z.record(z.string(), z.unknown());

type RawDevLoginBody = z.infer<typeof rawBodySchema>;

const readFormValue = (form: FormData, key: string): string | undefined => {
  const value = form.get(key);

  return typeof value === 'string' ? value : undefined;
};

/** Raw fields (unvalidated) so a failure can still redirect to the submitted returnTo. */
const readRawBody = async (request: NextRequest): Promise<RawDevLoginBody> => {
  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const parsed = rawBodySchema.safeParse(await request.json());

      return parsed.success ? parsed.data : {};
    }

    const form = await request.formData();

    return { displayName: readFormValue(form, 'displayName'), returnTo: readFormValue(form, 'returnTo') };
  } catch {
    return {};
  }
};

const notFoundResponse = (): Response =>
  new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_STORE },
  });

/**
 * Demo-only instant login (JSON or form). Same completion as the OAuth callback; 303 to `returnTo`.
 * A browser form never gets JSON back: outside demo mode plain 404, any failure → `returnTo?login=failed`.
 */
export const POST = async (request: NextRequest): Promise<Response> => {
  if (!isDevLoginEnabled()) {
    return notFoundResponse();
  }

  let returnTo = '/';

  try {
    assertSameOrigin(request);

    const raw = await readRawBody(request);

    returnTo = sanitizeReturnTo(raw.returnTo);

    const parsed = devLoginRequestSchema.safeParse(raw);

    if (!parsed.success) {
      throw new ApiError(ApiErrorCode.VALIDATION_ERROR);
    }

    const profile = getDevAuthProvider().createProfile(parsed.data.displayName ?? '');
    const db = await getDb();
    const result = await completeLogin(db, await getRequestContext(request, db), profile);

    return buildLoginRedirect(result, returnTo, 303);
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      console.warn('[auth] dev login failed', { code: error.code });
    } else {
      logUnexpectedError(request, error);
    }

    return buildLoginFailedRedirect(returnTo, 303);
  }
};
