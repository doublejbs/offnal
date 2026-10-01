import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Join screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type JoinLayoutProps = {
  children: ReactNode;
};

const JoinLayout = ({ children }: JoinLayoutProps) => children;

export default JoinLayout;
