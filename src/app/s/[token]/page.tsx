import { type Metadata } from 'next';

import SharedCalendarView from '@/components/shared/SharedCalendarView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '함께 보는 근무표 · 오프날',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

type SharedPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ month?: string }>;
};

/** Public read-only page. Data comes from GET /api/shared/:token (no-store, noindex headers). */
const SharedPage = async ({ params, searchParams }: SharedPageProps) => {
  const { token } = await params;
  const { month } = await searchParams;

  return <SharedCalendarView token={token} month={typeof month === 'string' ? month : null} />;
};

export default SharedPage;
