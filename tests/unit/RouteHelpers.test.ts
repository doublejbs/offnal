import { beforeEach, describe, expect, it } from 'vitest';

import { resetAppConfigForTesting } from '@/server/config/AppConfig';
import { buildAppUrl, buildLoginFailedUrl, sanitizeReturnTo } from '@/server/http/RouteHelpers';

const APP_ORIGIN = 'http://localhost:3100';

beforeEach(() => {
  resetAppConfigForTesting();
});

describe('sanitizeReturnTo', () => {
  it.each([
    ['protocol-relative', '//evil.com'],
    ['absolute URL', 'https://evil.com'],
    ['backslash', '/\\evil.com'],
    ['not a path', 'relative'],
    ['dot segment then double slash', '/.//evil.com'],
    ['parent segment then double slash', '/a/..//evil.com'],
    ['encoded control character', '/x\n'],
    ['non-string', 42],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeReturnTo(value)).toBe('/');
  });

  it('keeps same-origin paths with query and hash', () => {
    expect(sanitizeReturnTo('/recognitions/abc?x=1#top')).toBe('/recognitions/abc?x=1#top');
    expect(sanitizeReturnTo('/a/../calendar')).toBe('/calendar');
  });
});

describe('buildAppUrl', () => {
  it('always keeps the APP_URL origin, even for protocol-relative input', () => {
    expect(buildAppUrl('//evil.com/x').origin).toBe(APP_ORIGIN);
    expect(buildAppUrl('https://evil.com/x').origin).toBe(APP_ORIGIN);
    expect(buildAppUrl('/calendar?m=1').toString()).toBe(`${APP_ORIGIN}/calendar?m=1`);
  });

  it('builds login failure URLs on the app origin', () => {
    expect(buildLoginFailedUrl('/.//evil.com').toString()).toBe(`${APP_ORIGIN}/?login=failed`);
    expect(buildLoginFailedUrl('/recognitions/1?a=b').toString()).toBe(
      `${APP_ORIGIN}/recognitions/1?a=b&login=failed`,
    );
  });
});
