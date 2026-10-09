import JoinView from '@/components/join/JoinView';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { getAppConfig } from '@/server/config/AppConfig';
import { getServerComponentContext } from '@/server/http/RequestContext';

type JoinPageProps = {
  params: Promise<{ token: string }>;
};

/** Invite link: before login only the team name (fetched client-side from the public lookup). */
const JoinPage = async ({ params }: JoinPageProps) => {
  // Team "준비 중" mode: the layout shows the coming-soon screen; do no work here (Spec §24.2).
  if (isTeamComingSoon(getAppConfig())) {
    return null;
  }

  const { token } = await params;
  const context = await getServerComponentContext();

  return <JoinView key={token} token={token} isLoggedIn={Boolean(context.user)} />;
};

export default JoinPage;
