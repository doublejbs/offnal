'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/calendar', label: '달력' },
  { href: '/teams', label: '팀' },
];

const isCurrentSection = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Logged-in header menu: 달력 · 팀 (aria-current on the open section) and logout. */
const HeaderNav = () => {
  const pathname = usePathname() ?? '';

  return (
    <nav className="header-nav" aria-label="내 메뉴">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="textbutton header-link"
          aria-current={isCurrentSection(pathname, item.href) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
      <form method="post" action="/auth/logout?returnTo=%2F" className="logout-form">
        <button type="submit" className="textbutton logout-button">
          로그아웃
        </button>
      </form>
    </nav>
  );
};

export default HeaderNav;
