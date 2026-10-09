import { type ReactNode } from 'react';

import TeamComingSoonView from '@/components/team/TeamComingSoonView';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { getAppConfig } from '@/server/config/AppConfig';
import { getServerComponentContext } from '@/server/http/RequestContext';

type TeamComingSoonGateProps = {
  children: ReactNode;
};

/**
 * Server layout body of `/teams/**` and `/join/**`: in team "준비 중" mode the page (and every team or invite
 * fetch it would make) is replaced by the shared coming-soon screen (Spec §24.2).
 */
const TeamComingSoonGate = async ({ children }: TeamComingSoonGateProps) => {
  if (!isTeamComingSoon(getAppConfig())) {
    return children;
  }

  const context = await getServerComponentContext();

  return <TeamComingSoonView isLoggedIn={Boolean(context.user)} />;
};

export default TeamComingSoonGate;
