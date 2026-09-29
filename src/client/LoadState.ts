import { isApiClientError } from '@/client/ApiClient';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

/** Shared mapping from a failed screen load to what the screen shows. */
export const toScreenLoadState = (error: unknown): ScreenLoadState => {
  if (!isApiClientError(error)) {
    return ScreenLoadState.ERROR;
  }

  if (error.code === ApiErrorCode.AUTH_REQUIRED) {
    return ScreenLoadState.AUTH_REQUIRED;
  }

  if (error.code === ApiErrorCode.EXPIRED) {
    return ScreenLoadState.EXPIRED;
  }

  if (error.status === 404) {
    return ScreenLoadState.NOT_FOUND;
  }

  return ScreenLoadState.ERROR;
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';
