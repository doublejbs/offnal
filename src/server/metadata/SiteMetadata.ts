import { type Metadata } from 'next';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';

export const SITE_NAME = '오프날';
export const DEFAULT_TITLE = '오프날 — 근무표 한 장으로 내 근무 달력';
export const OG_IMAGE_PATH = '/og-image.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_ALT = '오프날 — 근무표 한 장이면 이번 달 준비 끝. 내 근무만 달력으로 정리한 화면';
export const SHARED_PAGE_TITLE = '공유받은 근무표';
export const SHARED_PAGE_DESCRIPTION = '오프날로 공유된 근무 달력이에요. 로그인 없이 볼 수 있어요.';

/** Per-user screens must never be indexed (Spec §14). */
export const PRIVATE_ROBOTS = { index: false, follow: false } satisfies Metadata['robots'];

export type SiteMetadataSource = {
  appUrl: string;
  priceKrw: number;
  freeMonthLimit: number;
};

const OG_IMAGE = {
  url: OG_IMAGE_PATH,
  width: OG_IMAGE_WIDTH,
  height: OG_IMAGE_HEIGHT,
  alt: OG_IMAGE_ALT,
};

export const buildSiteDescription = ({ priceKrw, freeMonthLimit }: SiteMetadataSource): string =>
  '근무표 사진을 올리면 내 근무만 달력으로 정리해 캘린더에 추가하고 가족·연인과 공유해요. ' +
  `처음 ${formatMonthCount(freeMonthLimit)} 무료, 이후 한 달분 ${formatPrice(priceKrw)}.`;

/** Root metadata: KakaoTalk and other link previews read these og/twitter tags. */
export const buildSiteMetadata = (source: SiteMetadataSource): Metadata => {
  const description = buildSiteDescription(source);

  return {
    metadataBase: new URL(source.appUrl),
    applicationName: SITE_NAME,
    title: { default: DEFAULT_TITLE, template: `%s · ${SITE_NAME}` },
    description,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'ko_KR',
      url: '/',
      title: DEFAULT_TITLE,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: DEFAULT_TITLE,
      description,
      images: [OG_IMAGE],
    },
  };
};

/**
 * /s/:token preview is fixed text only: no display name, month or shifts,
 * because messenger preview caches outlive a revoked link.
 */
export const SHARED_PAGE_METADATA: Metadata = {
  title: SHARED_PAGE_TITLE,
  description: SHARED_PAGE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'ko_KR',
    title: SHARED_PAGE_TITLE,
    description: SHARED_PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: SHARED_PAGE_TITLE,
    description: SHARED_PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: { ...PRIVATE_ROBOTS, nocache: true },
  referrer: 'no-referrer',
};
