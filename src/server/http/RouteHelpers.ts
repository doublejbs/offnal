import { type NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { getAppConfig } from '@/server/config/AppConfig';
import { ApiError } from '@/server/http/ApiError';

export const NO_STORE = 'no-store, max-age=0';

const DEFAULT_RETURN_TO = '/';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f\\]/u;
const UUID_SCHEMA = z.uuid();

export const jsonResponse = <T>(body: T, status = 200, headers: Record<string, string> = {}): NextResponse =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE, ...headers } });

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
const logUnexpectedError = (request: NextRequest, error: unknown): void => {
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

/** Wraps a route handler: maps ApiError/ZodError to JSON errors and hides unexpected failures. */
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

/** Route IDs are UUIDs; anything else is reported as not found (no existence leak, no DB error). */
export const requireUuid = (value: string): string => {
  if (!UUID_SCHEMA.safeParse(value).success) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return value;
};

export const buildAppUrl = (pathWithQuery: string): URL => new URL(pathWithQuery, getAppConfig().appUrl);

/** Accepts only same-origin relative paths ("/x", not "//x", "https://…" or backslashes). */
export const sanitizeReturnTo = (value: unknown): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }

  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return DEFAULT_RETURN_TO;
  }

  const url = buildAppUrl(value);

  if (url.origin !== getAppConfig().appUrl) {
    return DEFAULT_RETURN_TO;
  }

  return `${url.pathname}${url.search}${url.hash}`;
};

export const buildLoginFailedUrl = (returnTo: string): URL => {
  const url = buildAppUrl(returnTo);

  url.searchParams.set('login', 'failed');

  return url;
};

/** Client IP from the platform proxy header (first hop), or 'unknown'. */
export const getClientIp = (request: NextRequest): string => {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
};
