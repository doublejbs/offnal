import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { createAnthropicVisionProvider } from '@/server/vision/AnthropicVisionProvider';
import { type EvalModelTarget } from '@/server/vision/eval/EvalArgs';
import { createGeminiVisionProvider } from '@/server/vision/GeminiVisionProvider';
import { type VisionProvider } from '@/server/vision/VisionProvider';

const PROVIDER_TIMEOUT_MS = 240_000;

export const readEnv = (key: string): string | null => {
  const value = process.env[key]?.trim();

  return value ? value : null;
};

/** Provider for a target, or the reason it is skipped (missing key). Keys are never printed. */
export const createProvider = (target: EvalModelTarget): VisionProvider | string => {
  if (target.provider === VisionProviderType.ANTHROPIC) {
    const apiKey = readEnv('ANTHROPIC_API_KEY');

    if (!apiKey) {
      return 'ANTHROPIC_API_KEY is not set';
    }

    const effort = Object.values(VisionEffort).find((value) => value === readEnv('VISION_EFFORT'));

    return createAnthropicVisionProvider({
      apiKey,
      model: target.model,
      effort: effort ?? VisionEffort.MEDIUM,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
  }

  const apiKey = readEnv('GEMINI_API_KEY');

  if (!apiKey) {
    return 'GEMINI_API_KEY is not set';
  }

  return createGeminiVisionProvider({ apiKey, model: target.model, timeoutMs: PROVIDER_TIMEOUT_MS });
};
