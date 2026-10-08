'use client';

import { Analytics } from '@vercel/analytics/next';

import { redactPageView } from '@/client/PageViewRedaction';

/** Vercel Web Analytics page views (cookie-free) with token/id paths and non-utm queries removed (Spec §23.4). */
const PageAnalytics = () => <Analytics beforeSend={redactPageView} />;

export default PageAnalytics;
