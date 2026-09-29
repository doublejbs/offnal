import { z } from 'zod';

import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ApiError } from '@/server/errors/ApiError';
import { type LoggedInContext, type RequestContext } from '@/server/http/RequestContext';

const UUID_SCHEMA = z.uuid();

/** Route IDs are UUIDs; anything else is reported as not found (no existence leak, no DB error). */
export const requireUuid = (value: string): string => {
  if (!UUID_SCHEMA.safeParse(value).success) {
    throw new ApiError(ApiErrorCode.NOT_FOUND);
  }

  return value;
};

export const requireUser = (context: RequestContext): LoggedInContext => {
  if (!context.user) {
    throw new ApiError(ApiErrorCode.AUTH_REQUIRED);
  }

  return { ...context, user: context.user };
};
