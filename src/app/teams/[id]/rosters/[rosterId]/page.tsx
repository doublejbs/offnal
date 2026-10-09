import RosterEditorScreen from '@/components/roster/RosterEditorScreen';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { getAppConfig } from '@/server/config/AppConfig';

type RosterPageProps = {
  params: Promise<{ id: string; rosterId: string }>;
};

const RosterPage = async ({ params }: RosterPageProps) => {
  // Team "준비 중" mode: the layout shows the coming-soon screen; do no work here (Spec §24.2).
  if (isTeamComingSoon(getAppConfig())) {
    return null;
  }

  const { id, rosterId } = await params;

  return <RosterEditorScreen key={rosterId} teamId={id} rosterId={rosterId} />;
};

export default RosterPage;
