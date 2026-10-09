import TeamDetailView from '@/components/team/TeamDetailView';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { getAppConfig } from '@/server/config/AppConfig';

type TeamPageProps = {
  params: Promise<{ id: string }>;
};

const TeamPage = async ({ params }: TeamPageProps) => {
  // Team "준비 중" mode: the layout shows the coming-soon screen; do no work here (Spec §24.2).
  if (isTeamComingSoon(getAppConfig())) {
    return null;
  }

  const { id } = await params;

  return <TeamDetailView key={id} teamId={id} />;
};

export default TeamPage;
