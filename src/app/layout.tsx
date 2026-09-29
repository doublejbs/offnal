import './globals.css';

import { type Metadata, type Viewport } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import { type ReactNode } from 'react';

import { getEnvironmentBannerText } from '@/client/EnvironmentBanner';
import AppShell from '@/components/AppShell';
import ConfigProvider from '@/components/ConfigProvider';
import { buildPublicConfig } from '@/server/config/PublicConfig';

/** Every screen is per-user and reads runtime config; nothing is prerendered at build time. */
export const dynamic = 'force-dynamic';

const notoSansKr = Noto_Sans_KR({
  weight: ['400', '500', '600'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-kr',
});

export const metadata: Metadata = {
  title: '오프날',
  description: '근무표 사진으로 만드는 내 근무 달력',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#151a25' },
  ],
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = ({ children }: RootLayoutProps) => {
  // Same values as GET /api/config/public, resolved once per request on the server.
  const config = buildPublicConfig();

  return (
    <html lang="ko" className={notoSansKr.variable}>
      <body>
        <ConfigProvider config={config}>
          <AppShell bannerText={getEnvironmentBannerText(config)}>{children}</AppShell>
        </ConfigProvider>
      </body>
    </html>
  );
};

export default RootLayout;
