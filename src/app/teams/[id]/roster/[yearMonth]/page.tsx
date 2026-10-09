import TeamRosterReadView from '@/components/roster/TeamRosterReadView';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { getAppConfig } from '@/server/config/AppConfig';

type TeamRosterPageProps = {
  params: Promise<{ id: string; yearMonth: string }>;
};

const TeamRosterPage = async ({ params }: TeamRosterPageProps) => {
  // Team "준비 중" mode: the layout shows the coming-soon screen; do no work here (Spec §24.2).
  if (isTeamComingSoon(getAppConfig())) {
    return null;
  }

  const { id, yearMonth } = await params;

  return <TeamRosterReadView key={`${id}-${yearMonth}`} teamId={id} yearMonth={yearMonth} />;
};

export default TeamRosterPage;
