import { describe, expect, it } from 'vitest';

import { redactPagePath, redactPageUrl, redactPageView } from '@/client/PageViewRedaction';

const ORIGIN = 'https://offnal.example';
const TOKEN = 'Qx3v9_ZkT0aB7cD1eF2gH3iJ4kL5mN6oP7qR8sT9uV0';
const UUID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

describe('page view redaction (Spec §23.4)', () => {
  it.each([
    [`/s/${TOKEN}`, '/s/[token]'],
    [`/join/${TOKEN}`, '/join/[token]'],
    [`/recognitions/${UUID}`, '/recognitions/[id]'],
    [`/recognitions/${UUID}/select`, '/recognitions/[id]/select'],
    [`/drafts/${UUID}`, '/drafts/[id]'],
    [`/teams/${UUID}`, '/teams/[id]'],
    [`/teams/${UUID}/rosters/${UUID}`, '/teams/[id]/rosters/[id]'],
    [`/teams/${UUID}/roster/2026-10`, '/teams/[id]/roster/[yearMonth]'],
    ['/checkout/2026-10', '/checkout/[yearMonth]'],
    ['/checkout/2026-10/result', '/checkout/[yearMonth]/result'],
  ])('replaces ids and tokens in %s', (input, expected) => {
    expect(redactPagePath(input)).toBe(expected);
  });

  it('keeps paths without ids', () => {
    expect(redactPagePath('/')).toBe('/');
    expect(redactPagePath('/upload')).toBe('/upload');
    expect(redactPagePath('/teams')).toBe('/teams');
    expect(redactPagePath('/calendar/2026-10')).toBe('/calendar/2026-10');
  });

  it('replaces any uuid- or token-like segment elsewhere too', () => {
    expect(redactPagePath(`/future/${UUID}`)).toBe('/future/[id]');
    expect(redactPagePath(`/future/${TOKEN}`)).toBe('/future/[id]');
  });

  it('keeps only utm_* query parameters and drops the fragment', () => {
    expect(
      redactPageUrl(`${ORIGIN}/s/${TOKEN}?month=2026-10&utm_source=kakao&ics=1&utm_campaign=beta#top`),
    ).toBe(`${ORIGIN}/s/[token]?utm_source=kakao&utm_campaign=beta`);
    expect(redactPageUrl(`${ORIGIN}/upload?returnTo=%2Fdrafts%2F${UUID}`)).toBe(`${ORIGIN}/upload`);
  });

  it('drops unparsable urls', () => {
    expect(redactPageUrl('not a url')).toBeNull();
    expect(redactPageView({ type: 'pageview', url: 'not a url' })).toBeNull();
  });

  it('redacts the event url and keeps the rest of the event', () => {
    expect(redactPageView({ type: 'pageview', url: `${ORIGIN}/drafts/${UUID}` })).toEqual({
      type: 'pageview',
      url: `${ORIGIN}/drafts/[id]`,
    });
  });
});
