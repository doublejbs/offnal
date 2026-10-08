import { AppMode } from '@/domain/enums/AppMode';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';

type PageAnalyticsConfig = {
  appMode: AppMode;
  offnalEnv: OffnalEnv;
};

/** Vercel Web Analytics page views (Spec §23.4): live deployments only, never demo data or test runs. */
export const shouldRenderPageAnalytics = (config: PageAnalyticsConfig): boolean =>
  config.appMode === AppMode.LIVE && config.offnalEnv !== OffnalEnv.TEST;
