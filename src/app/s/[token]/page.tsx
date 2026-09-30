import { type Metadata } from 'next';

import SharedCalendarView from '@/components/shared/SharedCalendarView';
import { SHARED_PAGE_METADATA } from '@/server/metadata/SiteMetadata';

export const dynamic = 'force-dynamic';

/** Static on purpose: previews must not carry the display name, month or shifts (Spec §14). */
export const metadata: Metadata = SHARED_PAGE_METADATA;

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
