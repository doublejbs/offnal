import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { getAppConfig } from '@/server/config/AppConfig';
import { createAnthropicVisionProvider } from '@/server/vision/AnthropicVisionProvider';
import { createMockVisionProvider } from '@/server/vision/MockVisionProvider';
import { type VisionProvider } from '@/server/vision/VisionProvider';

type VisionGlobal = typeof globalThis & { __offnalVisionOverride?: VisionProvider | null };

const visionGlobal = globalThis as VisionGlobal;

export const getVisionProvider = (): VisionProvider => {
  if (visionGlobal.__offnalVisionOverride) {
    return visionGlobal.__offnalVisionOverride;
  }

  const config = getAppConfig();

  if (config.visionProvider === VisionProviderType.MOCK) {
    // AppConfig already refuses this combination; kept as a second guard.
    if (config.offnalEnv === OffnalEnv.PRODUCTION) {
      throw new Error('Mock vision provider is not allowed in production');
    }

    return createMockVisionProvider({ delayMs: config.mockVisionDelayMs });
  }

  return createAnthropicVisionProvider({
    apiKey: config.anthropicApiKey,
    model: config.visionModel,
    effort: config.visionEffort,
    timeoutMs: config.visionTimeoutMs,
  });
};

/** Overrides the provider returned by `getVisionProvider` (null clears). Tests only. */
export const setVisionProviderForTesting = (provider: VisionProvider | null): void => {
  visionGlobal.__offnalVisionOverride = provider;
};
