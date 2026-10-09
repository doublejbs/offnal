import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import TeamComingSoonGate from '@/components/team/TeamComingSoonGate';
import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Join screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type JoinLayoutProps = {
  children: ReactNode;
};

/** Team "준비 중" mode shows the shared coming-soon screen instead (Spec §24.2). */
const JoinLayout = ({ children }: JoinLayoutProps) => <TeamComingSoonGate>{children}</TeamComingSoonGate>;

export default JoinLayout;
