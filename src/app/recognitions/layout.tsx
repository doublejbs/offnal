import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Recognition screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type RecognitionsLayoutProps = {
  children: ReactNode;
};

const RecognitionsLayout = ({ children }: RecognitionsLayoutProps) => children;

export default RecognitionsLayout;
