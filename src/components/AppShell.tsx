import Link from 'next/link';
import { type ReactNode } from 'react';

import DemoBanner from '@/components/DemoBanner';
import HeaderNav from '@/components/HeaderNav';

type AppShellProps = {
  /** Demo / test-environment notice (see `getEnvironmentBannerText`); null hides the banner. */
  bannerText: string | null;
  /** Whether user is logged in; shows logout button when true. */
  isLoggedIn: boolean;
  /** Beta free mode: a small 베타 label next to the wordmark (Spec §20.4), not a warning banner. */
  isBeta: boolean;
  children: ReactNode;
};

/** Single 430px column: environment banner, wordmark header (logged in: 달력 · 팀 · 로그아웃), page content. */
const AppShell = ({ bannerText, isLoggedIn, isBeta, children }: AppShellProps) => (
  <div className="app">
    {bannerText && <DemoBanner message={bannerText} />}
    <header className="app-header">
      <div className="brand">
        <Link href="/" className="wordmark" aria-label="오프날 처음으로">
          오프<span>날</span>
        </Link>
        {isBeta && (
          <span className="beta-chip">
            베타<span className="visually-hidden"> 서비스</span>
          </span>
        )}
      </div>
      {isLoggedIn ? <HeaderNav /> : <span className="tiny">내 근무, 함께 보는 달력</span>}
    </header>
    <main className="main">{children}</main>
  </div>
);

export default AppShell;
