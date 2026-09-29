import { redirect } from 'next/navigation';

import UploadPanel from '@/components/upload/UploadPanel';
import { pickLandingMonth } from '@/domain/CalendarLanding';
import { getDb } from '@/server/db/Database';
import { getServerComponentContext } from '@/server/http/RequestContext';
import { getCalendarSummary } from '@/server/services/CalendarService';

const HomePage = async () => {
  const context = await getServerComponentContext();

  if (context.user) {
    const summary = await getCalendarSummary(await getDb(), context);
    const months = summary.months.map((month) => month.yearMonth);
    const target = pickLandingMonth(months, new Date());

    if (target) {
      redirect(`/calendar/${target}`);
    }
  }

  return <UploadPanel isLoggedIn={Boolean(context.user)} />;
};

export default HomePage;
