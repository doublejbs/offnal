import { describe, expect, it } from 'vitest';

import { LoginClickSource } from '@/domain/enums/LoginClickSource';
import { LoginFailureKind } from '@/domain/enums/LoginFailureKind';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { ShareLaterMethod } from '@/domain/enums/ShareLaterMethod';
import {
  type AnalyticsProperties,
  AnalyticsPropertyError,
  validateAnalyticsProperties,
} from '@/server/analytics/AnalyticsProperties';

describe('validateAnalyticsProperties', () => {
  it('accepts numbers, booleans and declared enum strings', () => {
    const properties: AnalyticsProperties = {
      attempt: 2,
      ms: 1530,
      success: false,
      errorCode: RecognitionErrorCode.NO_TABLE,
    };

    expect(validateAnalyticsProperties(properties)).toEqual(properties);
    expect(validateAnalyticsProperties({})).toEqual({});
  });

  it('accepts the entry-screen enums (Spec §26.5)', () => {
    const properties: AnalyticsProperties = {
      method: ShareLaterMethod.COPY,
      from: LoginClickSource.GATE,
      kind: LoginFailureKind.EXCHANGE_FAILED,
      inApp: true,
    };

    expect(validateAnalyticsProperties(properties)).toEqual(properties);
  });

  it('rejects free strings, also at the type level', () => {
    // @ts-expect-error plain strings are not analytics property values
    const named: AnalyticsProperties = { name: '김간호' };

    expect(() => validateAnalyticsProperties(named)).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ code: 'D' })).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ token: 'abcdefghijklmnopqrstuvwxyz012345' })).toThrow(
      AnalyticsPropertyError,
    );
  });

  it('rejects objects, arrays, null, dates and non-finite numbers', () => {
    // @ts-expect-error nested objects are not allowed
    const nested: AnalyticsProperties = { entries: { day: 1 } };

    expect(() => validateAnalyticsProperties(nested)).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ list: [1, 2] })).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ empty: null })).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ at: new Date() })).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ ms: Number.NaN })).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ ms: Number.POSITIVE_INFINITY })).toThrow(
      AnalyticsPropertyError,
    );
    expect(() => validateAnalyticsProperties({ missing: undefined })).toThrow(AnalyticsPropertyError);
  });

  it('rejects non-object property bags and odd keys', () => {
    expect(() => validateAnalyticsProperties(null)).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties([1])).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties('x')).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ 'user name': 1 })).toThrow(AnalyticsPropertyError);
    expect(() => validateAnalyticsProperties({ ['k'.repeat(64)]: 1 })).toThrow(AnalyticsPropertyError);
    expect(() =>
      validateAnalyticsProperties(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]))),
    ).toThrow(AnalyticsPropertyError);
  });

  it('never puts the rejected value in the error message', () => {
    try {
      validateAnalyticsProperties({ name: '김간호' });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AnalyticsPropertyError);
      expect((error as Error).message).not.toContain('김간호');
    }
  });
});
