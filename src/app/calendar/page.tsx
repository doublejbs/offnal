import Link from 'next/link';
import { redirect } from 'next/navigation';

import AuthRequired from '@/components/AuthRequired';
import EmptyState from '@/components/EmptyState';
import { pickLandingMonth } from '@/domain/CalendarLanding';
import { getDb } from '@/server/db/Database';
import { getServerComponentContext } from '@/server/http/RequestContext';
import { getCalendarSummary } from '@/server/services/CalendarService';

/** Latest month (the current month when it is published) or an empty state. */
const CalendarIndexPage = async () => {
  const context = await getServerComponentContext();

  if (!context.user) {
    return <AuthRequired returnTo="/calendar" description="로그인하면 저장한 달력을 볼 수 있어요." />;
  }

  const summary = await getCalendarSummary(await getDb(), context);
  const months = summary.months.map((month) => month.yearMonth);
  const target = pickLandingMonth(months, new Date());

  if (target) {
    redirect(`/calendar/${target}`);
  }

  return (
    <EmptyState
      label="내 달력"
      title="아직 저장한 달력이 없어요"
      description="근무표 사진을 올리고 내 근무를 확인하면 여기에 달력이 생겨요."
    >
      <Link href="/upload" className="primary">
        근무표 올리기
      </Link>
    </EmptyState>
  );
};

export default CalendarIndexPage;
