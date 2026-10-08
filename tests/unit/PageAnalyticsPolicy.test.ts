import { describe, expect, it } from 'vitest';

import { AppMode } from '@/domain/enums/AppMode';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { shouldRenderPageAnalytics } from '@/server/analytics/PageAnalyticsPolicy';

describe('shouldRenderPageAnalytics', () => {
  it('renders only for live, non-test environments', () => {
    expect(shouldRenderPageAnalytics({ appMode: AppMode.LIVE, offnalEnv: OffnalEnv.PRODUCTION })).toBe(true);
    expect(shouldRenderPageAnalytics({ appMode: AppMode.LIVE, offnalEnv: OffnalEnv.PREVIEW })).toBe(true);
    expect(shouldRenderPageAnalytics({ appMode: AppMode.LIVE, offnalEnv: OffnalEnv.DEVELOPMENT })).toBe(true);
    expect(shouldRenderPageAnalytics({ appMode: AppMode.DEMO, offnalEnv: OffnalEnv.PREVIEW })).toBe(false);
    expect(shouldRenderPageAnalytics({ appMode: AppMode.LIVE, offnalEnv: OffnalEnv.TEST })).toBe(false);
  });
});
