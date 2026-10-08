import { describe, expect, it } from 'vitest';

import { PUBLIC_SHARE_HEADERS } from '@/server/http/PublicShareHeaders';
import nextConfig from '../../next.config';

const loadRules = async () => {
  if (!nextConfig.headers) {
    throw new Error('next.config.ts must define headers()');
  }

  return nextConfig.headers();
};

const toRecord = (headers: { key: string; value: string }[]): Record<string, string> =>
  Object.fromEntries(headers.map((header) => [header.key.toLowerCase(), header.value]));

describe('next.config security headers', () => {
  it('applies the public share headers to /s/* pages and /api/shared/*', async () => {
    const rules = await loadRules();

    // Config headers override route response headers, so the share API needs the rule too.
    for (const source of ['/s/:path*', '/api/shared/:path*']) {
      const shareRule = rules.find((rule) => rule.source === source);

      expect(shareRule).toBeDefined();
      expect(toRecord(shareRule?.headers ?? [])).toMatchObject({
        'cache-control': 'no-store, max-age=0',
        'x-robots-tag': 'noindex, nofollow',
        'referrer-policy': 'no-referrer',
      });
    }

    expect(
      Object.fromEntries(
        Object.entries(PUBLIC_SHARE_HEADERS).map(([key, value]) => [key.toLowerCase(), value]),
      ),
    ).toEqual({
      'cache-control': 'no-store, max-age=0',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    });
  });

  it('sends no referrer from pages whose URL carries a token or id (analytics script, other sites)', async () => {
    const rules = await loadRules();
    const globalIndex = rules.findIndex((rule) => rule.source === '/:path*');

    for (const source of ['/join/:path*', '/teams/:path*', '/recognitions/:path*', '/drafts/:path*']) {
      const index = rules.findIndex((rule) => rule.source === source);

      expect(index).toBeGreaterThan(globalIndex);
      expect(toRecord(rules[index]?.headers ?? [])['referrer-policy']).toBe('no-referrer');
    }
  });

  it('sets baseline headers everywhere, with a stricter referrer policy only on share pages', async () => {
    const rules = await loadRules();
    const globalRule = rules.find((rule) => rule.source === '/:path*');
    const globalHeaders = toRecord(globalRule?.headers ?? []);

    expect(globalHeaders['x-content-type-options']).toBe('nosniff');
    expect(globalHeaders['permissions-policy']).toContain('camera=()');
    expect(globalHeaders['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(globalHeaders['x-frame-options']).toBe('DENY');
    expect(globalHeaders['content-security-policy']).toBe("frame-ancestors 'none'");

    // Later matching rules win in Next.js, so the share rule must come after the global one.
    expect(rules.findIndex((rule) => rule.source === '/s/:path*')).toBeGreaterThan(
      rules.findIndex((rule) => rule.source === '/:path*'),
    );
  });

  it('renders metadata in <head> for KakaoTalk and the default link-preview bots', () => {
    const bots = nextConfig.htmlLimitedBots;

    expect(bots).toBeInstanceOf(RegExp);
    expect(bots?.test('facebookexternalhit/1.1 kakaotalk-scrap/1.0; +https://devtalk.kakao.com/')).toBe(true);
    expect(bots?.test('kakaotalk-scrap/1.0')).toBe(true);
    expect(bots?.test('Twitterbot/1.0')).toBe(true);
    expect(bots?.test('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(bots?.test('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) KAKAOTALK 10.8.0')).toBe(false);
  });
});
