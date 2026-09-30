import { type VisionUsage } from '@/server/vision/VisionProvider';

export type ModelPrice = {
  /** USD per 1M input tokens (paid tier, standard, prompts ≤ 200k). */
  inputPerMillion: number;
  /** USD per 1M output tokens. Thinking tokens are billed as output. */
  outputPerMillion: number;
  note?: string;
};

// source: https://ai.google.dev/gemini-api/docs/pricing , https://claude.com/pricing (paid tier list prices)
// asOf: '2026-09-29'
export const MODEL_PRICES_AS_OF = '2026-09-29';

const GEMINI_FLASH_PROMO_NOTE = 'price doubles on 2027-01-01';

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gemini-3.8-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75, note: GEMINI_FLASH_PROMO_NOTE },
  'gemini-3.7-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75, note: GEMINI_FLASH_PROMO_NOTE },
  'gemini-3.6-flash': { inputPerMillion: 0.75, outputPerMillion: 3.75, note: GEMINI_FLASH_PROMO_NOTE },
  'gemini-3.5-flash': { inputPerMillion: 1.5, outputPerMillion: 9 },
  'gemini-3.5-flash-lite': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-3.1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'claude-opus-5-5': { inputPerMillion: 4, outputPerMillion: 20 },
  'claude-sonnet-5-5': { inputPerMillion: 2, outputPerMillion: 10 },
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
};

const TOKENS_PER_MILLION = 1_000_000;

/** Estimated paid-tier cost in USD, or null when the model has no price entry. */
export const estimateCostUsd = (model: string, usage: VisionUsage): number | null => {
  const price = MODEL_PRICES[model];

  if (!price) {
    return null;
  }

  const billedOutput = usage.outputTokens + (usage.thinkingTokens ?? 0);

  return (
    (usage.inputTokens * price.inputPerMillion + billedOutput * price.outputPerMillion) / TOKENS_PER_MILLION
  );
};
