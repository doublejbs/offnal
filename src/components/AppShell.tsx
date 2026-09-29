import Link from 'next/link';
import { type ReactNode } from 'react';

import DemoBanner from '@/components/DemoBanner';

type AppShellProps = {
  isDemo: boolean;
  children: ReactNode;
};

/** Single 430px column: demo banner, wordmark header, page content. */
const AppShell = ({ isDemo, children }: AppShellProps) => (
  <div className="app">
    {isDemo && <DemoBanner />}
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
