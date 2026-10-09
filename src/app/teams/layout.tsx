import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import TeamComingSoonView from '@/components/team/TeamComingSoonView';
import { isTeamComingSoon } from '@/domain/TeamPolicy';
import { getAppConfig } from '@/server/config/AppConfig';
import { getServerComponentContext } from '@/server/http/RequestContext';
import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Teams screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type TeamsLayoutProps = {
  children: ReactNode;
};

/**
 * Team "준비 중" mode shows the shared coming-soon screen instead of the page (Spec §24.2). Layouts and pages
 * render in parallel, so every page below also returns early on its own (no params, session or team reads).
 */
const TeamsLayout = async ({ children }: TeamsLayoutProps) => {
  if (!isTeamComingSoon(getAppConfig())) {
    return children;
  }

  const context = await getServerComponentContext();

  return <TeamComingSoonView isLoggedIn={Boolean(context.user)} />;
};

export default TeamsLayout;
