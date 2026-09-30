import { type ApiErrorCode } from '@/domain/enums/ApiErrorCode';

/** Common error body for every API route. `message` is user-facing Korean text. */
export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};
