import { describe, expect, it } from 'vitest';

import {
  buildSiteMetadata,
  OG_IMAGE_PATH,
  PRIVATE_ROBOTS,
  SHARED_PAGE_DESCRIPTION,
  SHARED_PAGE_METADATA,
  SHARED_PAGE_TITLE,
} from '@/server/metadata/SiteMetadata';

const SOURCE = { appUrl: 'https://offnal.example', priceKrw: 1900, freeMonthLimit: 2 };

describe('buildSiteMetadata', () => {
  it('uses APP_URL as metadataBase and the title template', () => {
    const metadata = buildSiteMetadata(SOURCE);

    expect(metadata.metadataBase?.toString()).toBe('https://offnal.example/');
    expect(metadata.title).toEqual({
      default: '오프날 — 근무표 한 장으로 내 근무 달력',
      template: '%s · 오프날',
    });
  });

  it('builds the description from pricing config', () => {
    expect(buildSiteMetadata(SOURCE).description).toBe(
      '근무표 사진을 올리면 내 근무만 달력으로 정리해 캘린더에 추가하고 가족·연인과 공유해요. 처음 두 달 무료, 이후 한 달분 1,900원.',
    );
    expect(buildSiteMetadata({ ...SOURCE, priceKrw: 2500, freeMonthLimit: 1 }).description).toContain(
      '처음 한 달 무료, 이후 한 달분 2,500원.',
    );
  });

  it('declares a 1200x630 og image, ko_KR locale and a large twitter card', () => {
    const metadata = buildSiteMetadata(SOURCE);

    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: '오프날',
      locale: 'ko_KR',
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630 }],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});

describe('SHARED_PAGE_METADATA', () => {
  it('is fixed, privacy-safe text with noindex', () => {
    expect(SHARED_PAGE_METADATA.title).toBe(SHARED_PAGE_TITLE);
    expect(SHARED_PAGE_METADATA.description).toBe(SHARED_PAGE_DESCRIPTION);
    expect(SHARED_PAGE_METADATA.openGraph).toMatchObject({
      title: SHARED_PAGE_TITLE,
      description: SHARED_PAGE_DESCRIPTION,
      images: [{ url: OG_IMAGE_PATH }],
    });
    expect(SHARED_PAGE_METADATA.robots).toMatchObject(PRIVATE_ROBOTS);
  });
});
