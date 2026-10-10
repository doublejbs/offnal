import { describe, expect, it } from 'vitest';

import { BillingMode } from '@/domain/enums/BillingMode';
import { parseAppConfig } from '@/server/config/AppConfig';
import {
  buildEntryPageMetadata,
  buildSiteMetadata,
  OG_IMAGE_PATH,
  PRIVATE_ROBOTS,
  readSiteMetadataSource,
  SHARED_PAGE_DESCRIPTION,
  SHARED_PAGE_METADATA,
  SHARED_PAGE_TITLE,
} from '@/server/metadata/SiteMetadata';

const SOURCE = {
  appUrl: 'https://offnal.example',
  billingMode: BillingMode.PAID,
  priceKrw: 990,
  freeMonthLimit: 2,
};

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
      '3교대 근무표 사진 한 장으로 내 D·E·N만 달력에 정리해 캘린더에 추가하고 가족·연인과 공유해요. 처음 두 달 무료, 이후 한 달분 990원.',
    );
    expect(buildSiteMetadata({ ...SOURCE, priceKrw: 2500, freeMonthLimit: 1 }).description).toContain(
      '처음 한 달 무료, 이후 한 달분 2,500원.',
    );
  });

  it('drops price and free months from the description in beta free mode', () => {
    const description = buildSiteMetadata({ ...SOURCE, billingMode: BillingMode.BETA_FREE }).description;

    expect(description).toBe(
      '3교대 근무표 사진 한 장으로 내 D·E·N만 달력에 정리해 캘린더에 추가하고 가족·연인과 공유해요.',
    );
    expect(description).not.toMatch(/원|무료|결제|이용권/);
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

  it('leaves og:url unset so child pages do not inherit the home URL', () => {
    expect(buildSiteMetadata(SOURCE).openGraph).not.toHaveProperty('url');
  });
});

describe('readSiteMetadataSource', () => {
  it('reads the billing mode from config', () => {
    const paid = readSiteMetadataSource(parseAppConfig({ OFFNAL_ENV: 'development' }));
    const betaFree = readSiteMetadataSource(
      parseAppConfig({ OFFNAL_ENV: 'development', BILLING_MODE: 'beta_free' }),
    );

    expect(paid.billingMode).toBe(BillingMode.PAID);
    expect(betaFree.billingMode).toBe(BillingMode.BETA_FREE);
  });
});

describe('buildEntryPageMetadata', () => {
  it('keeps the site og tags and adds the page own og:url', () => {
    const { openGraph } = buildEntryPageMetadata(SOURCE, '/upload');

    expect(openGraph).toMatchObject({
      url: '/upload',
      locale: 'ko_KR',
      title: '오프날 — 근무표 한 장으로 내 근무 달력',
      description: buildSiteMetadata(SOURCE).description,
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630 }],
    });
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
    expect(SHARED_PAGE_METADATA.openGraph).not.toHaveProperty('url');
    expect(SHARED_PAGE_METADATA.robots).toMatchObject(PRIVATE_ROBOTS);
    // Same as the /s/* header: origin only, so the logout form POST keeps a real Origin.
    expect(SHARED_PAGE_METADATA.referrer).toBe('strict-origin');
  });
});
