import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Checkout screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type CheckoutLayoutProps = {
  children: ReactNode;
};

const CheckoutLayout = ({ children }: CheckoutLayoutProps) => children;

export default CheckoutLayout;
