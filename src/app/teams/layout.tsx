import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Teams screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type TeamsLayoutProps = {
  children: ReactNode;
};

const TeamsLayout = ({ children }: TeamsLayoutProps) => children;

export default TeamsLayout;
