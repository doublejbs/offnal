import Link from 'next/link';
import { type ReactNode } from 'react';

import DemoBanner from '@/components/DemoBanner';

type AppShellProps = {
  /** Demo / test-environment notice (see `getEnvironmentBannerText`); null hides the banner. */
  bannerText: string | null;
  /** Whether user is logged in; shows logout button when true. */
  isLoggedIn: boolean;
  children: ReactNode;
};

/** Single 430px column: environment banner, wordmark header (logged in: 달력 · 팀 · 로그아웃), page content. */
const AppShell = ({ bannerText, isLoggedIn, children }: AppShellProps) => (
  <div className="app">
    {bannerText && <DemoBanner message={bannerText} />}
    <header className="app-header">
      <Link href="/" className="wordmark" aria-label="오프날 처음으로">
        오프<span>날</span>
      </Link>
      {isLoggedIn ? (
        <nav className="header-nav" aria-label="내 메뉴">
          <Link href="/calendar" className="textbutton header-link">
            달력
          </Link>
          <Link href="/teams" className="textbutton header-link">
            팀
          </Link>
          <form method="post" action="/auth/logout?returnTo=%2F" className="logout-form">
            <button type="submit" className="textbutton logout-button">
              로그아웃
            </button>
          </form>
        </nav>
      ) : (
        <span className="tiny">내 근무, 함께 보는 달력</span>
      )}
    </header>
    <main className="main">{children}</main>
  </div>
);

export default AppShell;
