import { type Metadata, type Viewport } from 'next';
import { type ReactNode } from 'react';

export const metadata: Metadata = {
  title: '오프날',
  description: '근무표 사진으로 만드는 내 근무 달력',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = ({ children }: RootLayoutProps) => (
  <html lang="ko">
    <body>{children}</body>
  </html>
);

export default RootLayout;
