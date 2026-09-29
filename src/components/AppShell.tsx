import Link from 'next/link';
import { type ReactNode } from 'react';

import DemoBanner from '@/components/DemoBanner';

type AppShellProps = {
  /** Demo / test-environment notice (see `getEnvironmentBannerText`); null hides the banner. */
  bannerText: string | null;
  children: ReactNode;
};

/** Single 430px column: environment banner, wordmark header, page content. */
const AppShell = ({ bannerText, children }: AppShellProps) => (
  <div className="app">
    {bannerText && <DemoBanner message={bannerText} />}
    <header className="app-header">
      <Link href="/" className="wordmark" aria-label="오프날 처음으로">
        오프<span>날</span>
      </Link>
      <span className="tiny">내 근무, 함께 보는 달력</span>
    </header>
    <main className="main">{children}</main>
  </div>
);

export default AppShell;
