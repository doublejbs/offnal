import { type AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { getAppConfig } from '@/server/config/AppConfig';

/** Only numbers and booleans: never names, schedules, tokens or source data. */
export type AnalyticsProperties = Record<string, number | boolean>;

/** Structured console log in development; no-op elsewhere until a real sink is chosen. */
export const track = (event: AnalyticsEvent, properties: AnalyticsProperties = {}): void => {
  if (getAppConfig().offnalEnv !== OffnalEnv.DEVELOPMENT) {
    return;
  }

  console.info(JSON.stringify({ type: 'analytics', event, properties, at: new Date().toISOString() }));
};
