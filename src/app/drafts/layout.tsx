import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Draft screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type DraftsLayoutProps = {
  children: ReactNode;
};

const DraftsLayout = ({ children }: DraftsLayoutProps) => children;

export default DraftsLayout;
