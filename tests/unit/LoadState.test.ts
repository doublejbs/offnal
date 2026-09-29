import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/client/ApiClient';
import { toScreenLoadState } from '@/client/LoadState';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

describe('LoadState', () => {
  it('maps API errors to screen states', () => {
    expect(toScreenLoadState(new ApiClientError(401, ApiErrorCode.AUTH_REQUIRED, ''))).toBe(
      ScreenLoadState.AUTH_REQUIRED,
    );
    expect(toScreenLoadState(new ApiClientError(410, ApiErrorCode.EXPIRED, ''))).toBe(
      ScreenLoadState.EXPIRED,
    );
    expect(toScreenLoadState(new ApiClientError(404, ApiErrorCode.NOT_FOUND, ''))).toBe(
      ScreenLoadState.NOT_FOUND,
    );
    expect(toScreenLoadState(new ApiClientError(500, ApiErrorCode.INTERNAL_ERROR, ''))).toBe(
      ScreenLoadState.ERROR,
    );
    expect(toScreenLoadState(new ApiClientError(0, null, ''))).toBe(ScreenLoadState.ERROR);
    expect(toScreenLoadState(new Error('x'))).toBe(ScreenLoadState.ERROR);
  });
});
