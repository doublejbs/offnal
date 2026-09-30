import Anthropic from '@anthropic-ai/sdk';
import {
  type BetaBase64ImageSource,
  type BetaContentBlockParam,
  type BetaOutputConfig,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import {
  parsePersonOutput,
  parseRowLocationOutput,
  parseStripPersonOutput,
  parseTableOutput,
} from '@/server/vision/VisionOutputParser';
import {
  buildPersonUserPrompt,
  buildRowLocationPrompt,
  buildStripPersonPrompt,
  PERSON_JSON_SCHEMA,
  ROW_LOCATION_JSON_SCHEMA,
  STRIP_PERSON_JSON_SCHEMA,
  STRIP_IMAGE_LABEL,
  REFERENCE_IMAGE_LABEL,
  TABLE_JSON_SCHEMA,
  TABLE_USER_PROMPT,
  VISION_SYSTEM_PROMPT,
} from '@/server/vision/VisionPrompts';
import {
  type LabeledVisionImage,
  type VisionModelCallResult,
  type VisionPersonResult,
  type VisionProvider,
  VisionProviderError,
  type VisionRowLocationResult,
  type VisionTableResult,
} from '@/server/vision/VisionProvider';

const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type MediaType = BetaBase64ImageSource['media_type'];
type Effort = NonNullable<BetaOutputConfig['effort']>;

const EFFORT_BY_SETTING: Record<VisionEffort, Effort> = {
  [VisionEffort.LOW]: 'low',
  [VisionEffort.MEDIUM]: 'medium',
  [VisionEffort.HIGH]: 'high',
  [VisionEffort.XHIGH]: 'xhigh',
  [VisionEffort.MAX]: 'max',
};

export type AnthropicVisionConfig = {
  apiKey: string | null;
  model: string;
  effort: VisionEffort;
  timeoutMs: number;
};

const toMediaType = (mime: ImageMimeType): MediaType => {
  switch (mime) {
    case ImageMimeType.JPEG:
      return 'image/jpeg';
    case ImageMimeType.PNG:
      return 'image/png';
    case ImageMimeType.WEBP:
      return 'image/webp';
    default:
      throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }
};

const mapProviderError = (error: unknown, signal: AbortSignal): VisionProviderError => {
  if (error instanceof VisionProviderError) {
    return error;
  }

  if (
    signal.aborted ||
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT, { cause: error });
  }

  // Anthropic.APIError subclasses (auth, rate limit, overloaded, …), JSON/zod failures and anything else.
  return new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR, { cause: error });
};

/** Optional text label, then the image (labels tell multi-image prompts which image is which). */
const toImageBlocks = ({ label, image }: LabeledVisionImage): BetaContentBlockParam[] => [
  ...(label === null ? [] : [{ type: 'text' as const, text: label }]),
  {
    type: 'image',
    source: { type: 'base64', media_type: toMediaType(image.mime), data: image.bytes.toString('base64') },
  },
];

/** Claude vision adapter. Never logs image data or recognized names. */
export const createAnthropicVisionProvider = (config: AnthropicVisionConfig): VisionProvider => {
  // One client per provider instance (the provider itself is cached by VisionFactory).
  const client = config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : null;

  const callModel = async (
    images: LabeledVisionImage[],
    text: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    effort: VisionEffort = config.effort,
  ): Promise<VisionModelCallResult> => {
    if (!client) {
      throw new VisionProviderError(RecognitionErrorCode.PROVIDER_NOT_CONFIGURED);
    }

    try {
      const message = await client.beta.messages.create(
        {
          model: config.model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: EFFORT_BY_SETTING[effort],
            format: { type: 'json_schema', schema },
          },
          system: VISION_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [...images.flatMap(toImageBlocks), { type: 'text', text }],
            },
          ],
        },
        { signal, timeout: config.timeoutMs },
      );

      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
        throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
      }

      const output = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

      return {
        output: JSON.parse(output) as unknown,
        // Anthropic bills thinking as output and does not report it separately.
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          thinkingTokens: null,
        },
      };
    } catch (error: unknown) {
      throw mapProviderError(error, signal);
    }
  };

  return {
    kind: VisionProviderType.ANTHROPIC,
    recognizeTable: async (image, signal): Promise<VisionTableResult> => {
      const { output, usage } = await callModel(
        [{ label: null, image }],
        TABLE_USER_PROMPT,
        TABLE_JSON_SCHEMA,
        signal,
      );

      return { ...parseTableOutput(output), usage };
    },
    extractPerson: async (image, input, signal): Promise<VisionPersonResult> => {
      const { output, usage } = await callModel(
        [{ label: null, image }],
        buildPersonUserPrompt(input),
        PERSON_JSON_SCHEMA,
        signal,
      );

      return { ...parsePersonOutput(output, input), usage };
    },
    // A short geometric answer: low effort keeps thinking (billed as output) small.
    locateRow: async (image, input, signal): Promise<VisionRowLocationResult> => {
      const { output, usage } = await callModel(
        [{ label: null, image }],
        buildRowLocationPrompt(input),
        ROW_LOCATION_JSON_SCHEMA,
        signal,
        VisionEffort.LOW,
      );

      return { band: parseRowLocationOutput(output), usage };
    },
    extractPersonFromStrip: async (strip, reference, input, signal): Promise<VisionPersonResult> => {
      const { output, usage } = await callModel(
        [
          { label: STRIP_IMAGE_LABEL, image: strip },
          { label: REFERENCE_IMAGE_LABEL, image: reference },
        ],
        buildStripPersonPrompt(input),
        STRIP_PERSON_JSON_SCHEMA,
        signal,
      );

      return { ...parseStripPersonOutput(output, input), usage };
    },
  };
};
