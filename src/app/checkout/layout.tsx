import { type Metadata } from 'next';
import { notFound } from 'next/navigation';
import { type ReactNode } from 'react';

import { isBetaFree } from '@/domain/BillingPolicy';
import { getAppConfig } from '@/server/config/AppConfig';
import { PRIVATE_ROBOTS } from '@/server/metadata/SiteMetadata';

/** Checkout screens are per-user: keep them out of search indexes. */
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };

type CheckoutLayoutProps = {
  children: ReactNode;
};

/** Beta free mode has no checkout (Spec §20.3). */
const CheckoutLayout = ({ children }: CheckoutLayoutProps) => {
  if (isBetaFree(getAppConfig())) {
    notFound();
  }

  return children;
};

export default CheckoutLayout;
