import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Calendar screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type CalendarLayoutProps = {
  children: ReactNode;
};

const CalendarLayout = ({ children }: CalendarLayoutProps) => children;

export default CalendarLayout;
