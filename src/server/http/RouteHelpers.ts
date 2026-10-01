import { type NextRequest, NextResponse } from 'next/server';
import { type z, ZodError } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/errors/ApiError';

export const NO_STORE = 'no-store, max-age=0';

const DEFAULT_RETURN_TO = '/';
const UNSAFE_RETURN_TO_PATTERN = /[\u0000-\u001f\u007f\\]/u;
/** Base for parsing relative paths only; never part of an output URL. */
const PATH_PARSE_BASE = 'http://path.invalid';

export const jsonResponse = <T>(body: T, status = 200, headers: Record<string, string> = {}): NextResponse =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE, ...headers } });

const INCLUDE_OFF_VALUES = new Set(['1', 'true']);

/** `includeOff=1` (or `true`) on an ICS export; anything else keeps days off out. */
export const parseIncludeOff = (searchParams: URLSearchParams): boolean =>
  INCLUDE_OFF_VALUES.has(searchParams.get('includeOff') ?? '');

/** A downloadable, uncached ICS attachment. */
export const icsResponse = (fileName: string, body: string): NextResponse =>
  new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': NO_STORE,
    },
  });

export const errorResponse = (error: ApiError): NextResponse => {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };

  return jsonResponse(body, error.status);
};

const readErrorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' ? code : undefined;
};

/** Logs unexpected errors without request data. Full details only outside production. */
export const logUnexpectedError = (request: NextRequest, error: unknown): void => {
  const summary = {
    method: request.method,
    path: request.nextUrl.pathname,
    name: error instanceof Error ? error.name : typeof error,
    code: readErrorCode(error),
  };

  if (getAppConfig().offnalEnv === OffnalEnv.PRODUCTION) {
    console.error('[api] unexpected error', summary);

    return;
  }

  console.error('[api] unexpected error', summary, error);
};

export const toErrorResponse = (request: NextRequest, error: unknown): NextResponse => {
  if (error instanceof ApiError) {
    return errorResponse(error);
  }

  if (error instanceof ZodError) {
    const fields = [...new Set(error.issues.map((issue) => issue.path.join('.')))];

    return errorResponse(new ApiError(ApiErrorCode.VALIDATION_ERROR, { details: { fields } }));
  }

  logUnexpectedError(request, error);

  return errorResponse(new ApiError(ApiErrorCode.INTERNAL_ERROR));
};

/** Wraps a JSON route handler: maps ApiError/ZodError to JSON errors and hides unexpected failures. */
export const withRoute =
  <TArgs extends [NextRequest, ...unknown[]]>(handler: (...args: TArgs) => Promise<Response>) =>
  async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error: unknown) {
      return toErrorResponse(args[0], error);
    }
  };

/** CSRF defence for state-changing requests: Origin must equal the APP_URL origin (missing is rejected). */
export const assertSameOrigin = (request: NextRequest): void => {
  const origin = request.headers.get('origin');

  if (!origin || origin !== getAppConfig().appUrl) {
    throw new ApiError(ApiErrorCode.FORBIDDEN_ORIGIN);
  }
};

export const parseJsonBody = async <T extends z.ZodType>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR);
  }

  return schema.parse(body);
};

/** Like parseJsonBody, but an empty body counts as `{}` (endpoints whose body is all optional). */
export const parseOptionalJsonBody = async <T extends z.ZodType>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> => {
  const text = await request.text();

  if (text.trim() === '') {
    return schema.parse({});
  }

  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(ApiErrorCode.VALIDATION_ERROR);
  }

  return schema.parse(body);
};

/**
 * Builds an absolute app URL from a path. The origin always comes from APP_URL: only pathname,
 * search and hash are taken from the input, so protocol-relative input cannot change the host.
 */
export const buildAppUrl = (pathWithQuery: string): URL => {
  const parsed = new URL(pathWithQuery, PATH_PARSE_BASE);
  const url = new URL(getAppConfig().appUrl);

  url.pathname = parsed.pathname;
  url.search = parsed.search;
  url.hash = parsed.hash;

  return url;
};

/**
 * Accepts only same-origin relative paths. Rejects "//x", absolute URLs, backslashes, control
 * characters, and paths whose normalized form starts with "//" (e.g. "/.//x", "/a/..//x").
 */
export const sanitizeReturnTo = (value: unknown): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }

  if (UNSAFE_RETURN_TO_PATTERN.test(value)) {
    return DEFAULT_RETURN_TO;
  }

  const parsed = new URL(value, PATH_PARSE_BASE);

  if (parsed.origin !== PATH_PARSE_BASE || parsed.pathname.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

export const buildLoginFailedUrl = (returnTo: string): URL => {
  const url = buildAppUrl(sanitizeReturnTo(returnTo));

  url.searchParams.set('login', 'failed');

  return url;
};

/** Browser redirect to `returnTo?login=failed` (never JSON). */
export const buildLoginFailedRedirect = (returnTo: string, status: number): NextResponse => {
  const response = NextResponse.redirect(buildLoginFailedUrl(returnTo), status);

  response.headers.set('Cache-Control', NO_STORE);

  return response;
};

/**
 * Wraps a browser-navigation route (login/callback): never answers with JSON. Any failure is
 * logged and redirected to `returnTo?login=failed`.
 */
export const withRedirectRoute =
  (handler: (request: NextRequest) => Promise<Response>, resolveReturnTo: (request: NextRequest) => string) =>
  async (request: NextRequest): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        console.warn('[auth] login redirect failed', { path: request.nextUrl.pathname, code: error.code });
      } else {
        logUnexpectedError(request, error);
      }

      return buildLoginFailedRedirect(resolveReturnTo(request), 302);
    }
  };
