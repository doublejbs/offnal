import { GeminiTier } from '@/domain/enums/GeminiTier';
import { OffnalEnv } from '@/domain/enums/OffnalEnv';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type AppConfig, getAppConfig } from '@/server/config/AppConfig';
import { createAnthropicVisionProvider } from '@/server/vision/AnthropicVisionProvider';
import { createGeminiVisionProvider } from '@/server/vision/GeminiVisionProvider';
import { createMockVisionProvider } from '@/server/vision/MockVisionProvider';
import { type VisionProvider } from '@/server/vision/VisionProvider';

type VisionGlobal = typeof globalThis & {
  /** Cached per AppConfig instance, so `resetAppConfigForTesting` also resets the provider. */
  __offnalVisionProvider?: { config: AppConfig; provider: VisionProvider };
  __offnalVisionOverride?: VisionProvider | null;
};

const visionGlobal = globalThis as VisionGlobal;

const createVisionProviderFromConfig = (config: AppConfig): VisionProvider => {
  if (config.visionProvider === VisionProviderType.MOCK) {
    // AppConfig already refuses this combination; kept as a second guard.
    if (config.offnalEnv === OffnalEnv.PRODUCTION) {
      throw new Error('Mock vision provider is not allowed in production');
    }

    return createMockVisionProvider({ delayMs: config.mockVisionDelayMs });
  }

  if (config.visionProvider === VisionProviderType.GEMINI) {
    // AppConfig refuses a free-tier key in production (inputs may be used for training).
    if (config.offnalEnv === OffnalEnv.PRODUCTION && config.geminiTier !== GeminiTier.PAID) {
      throw new Error('Gemini vision provider requires GEMINI_TIER=paid in production');
    }

    return createGeminiVisionProvider({
      apiKey: config.geminiApiKey,
      model: config.visionModel,
      timeoutMs: config.visionTimeoutMs,
    });
  }

  return createAnthropicVisionProvider({
    apiKey: config.anthropicApiKey,
    model: config.visionModel,
    effort: config.visionEffort,
    timeoutMs: config.visionTimeoutMs,
  });
};

export const getVisionProvider = (): VisionProvider => {
  if (visionGlobal.__offnalVisionOverride) {
    return visionGlobal.__offnalVisionOverride;
  }

  const config = getAppConfig();
  const cached = visionGlobal.__offnalVisionProvider;

  if (cached?.config === config) {
    return cached.provider;
  }

  const provider = createVisionProviderFromConfig(config);

  visionGlobal.__offnalVisionProvider = { config, provider };

  return provider;
};

/** Overrides the provider returned by `getVisionProvider` (null clears). Tests only. */
export const setVisionProviderForTesting = (provider: VisionProvider | null): void => {
  visionGlobal.__offnalVisionOverride = provider;
};
