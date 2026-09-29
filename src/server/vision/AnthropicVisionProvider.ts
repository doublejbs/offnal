import Anthropic from '@anthropic-ai/sdk';
import {
  type BetaBase64ImageSource,
  type BetaOutputConfig,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { VisionTableOutcome } from '@/domain/enums/VisionTableOutcome';
import { type PersonExtraction } from '@/domain/types/PersonExtraction';
import { type TableRecognitionResult } from '@/domain/types/TableRecognitionResult';
import {
  buildPersonUserPrompt,
  PERSON_JSON_SCHEMA,
  personOutputSchema,
  sanitizeDefinition,
  sanitizeYearMonth,
  TABLE_JSON_SCHEMA,
  TABLE_USER_PROMPT,
  tableOutputSchema,
  VISION_SYSTEM_PROMPT,
} from '@/server/vision/VisionPrompts';
import { type VisionImage, type VisionProvider, VisionProviderError } from '@/server/vision/VisionProvider';

const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_NAME_LENGTH = 40;

type MediaType = BetaBase64ImageSource['media_type'];
type Effort = NonNullable<BetaOutputConfig['effort']>;

const EFFORT_BY_SETTING: Record<VisionEffort, Effort> = {
  [VisionEffort.LOW]: 'low',
  [VisionEffort.MEDIUM]: 'medium',
  [VisionEffort.HIGH]: 'high',
  [VisionEffort.XHIGH]: 'xhigh',
  [VisionEffort.MAX]: 'max',
};

const FAILURE_BY_OUTCOME: Record<VisionTableOutcome, RecognitionErrorCode | null> = {
  [VisionTableOutcome.OK]: null,
  [VisionTableOutcome.NO_TABLE]: RecognitionErrorCode.NO_TABLE,
  [VisionTableOutcome.UNREADABLE]: RecognitionErrorCode.UNREADABLE,
  [VisionTableOutcome.NO_NAMES]: RecognitionErrorCode.NO_NAMES,
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
    return new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT);
  }

  // Anthropic.APIError subclasses (auth, rate limit, overloaded, …), JSON/zod failures and anything else.
  return new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
};

/** Claude vision adapter. Never logs image data or recognized names. */
export const createAnthropicVisionProvider = (config: AnthropicVisionConfig): VisionProvider => {
  const callModel = async (
    image: VisionImage,
    text: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (!config.apiKey) {
      throw new VisionProviderError(RecognitionErrorCode.PROVIDER_NOT_CONFIGURED);
    }

    const client = new Anthropic({ apiKey: config.apiKey });

    try {
      const message = await client.beta.messages.create(
        {
          model: config.model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: EFFORT_BY_SETTING[config.effort],
            format: { type: 'json_schema', schema },
          },
          system: VISION_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: toMediaType(image.mime),
                    data: image.bytes.toString('base64'),
                  },
                },
                { type: 'text', text },
              ],
            },
          ],
        },
        { signal, timeout: config.timeoutMs },
      );

      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
        throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
      }

      const output = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

      return JSON.parse(output) as unknown;
    } catch (error: unknown) {
      throw mapProviderError(error, signal);
    }
  };

  return {
    kind: VisionProviderType.ANTHROPIC,
    recognizeTable: async (image, signal): Promise<TableRecognitionResult> => {
      const raw = await callModel(image, TABLE_USER_PROMPT, TABLE_JSON_SCHEMA, signal);
      const parsed = tableOutputSchema.safeParse(raw);

      if (!parsed.success) {
        throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
      }

      const failure = FAILURE_BY_OUTCOME[parsed.data.outcome];

      if (failure) {
        return { ok: false, errorCode: failure };
      }

      const seenRowIds = new Set<string>();
      const candidates = parsed.data.candidates.flatMap((candidate) => {
        const rowId = candidate.rowId.trim();
        const name = candidate.name.trim().slice(0, MAX_NAME_LENGTH);

        if (!rowId || !name || seenRowIds.has(rowId)) {
          return [];
        }

        seenRowIds.add(rowId);

        return [{ rowId, name }];
      });

      if (candidates.length === 0) {
        return { ok: false, errorCode: RecognitionErrorCode.NO_NAMES };
      }

      return {
        ok: true,
        value: {
          yearMonth: sanitizeYearMonth(parsed.data.yearMonth),
          candidates,
          definitions: parsed.data.definitions.map(sanitizeDefinition),
          dayHeaders: parsed.data.dayHeaders.filter((header) => header.day >= 1 && header.day <= 31),
        },
      };
    },
    extractPerson: async (image, input, signal): Promise<PersonExtraction> => {
      const raw = await callModel(image, buildPersonUserPrompt(input), PERSON_JSON_SCHEMA, signal);
      const parsed = personOutputSchema.safeParse(raw);

      if (!parsed.success) {
        throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
      }

      return {
        yearMonth: input.yearMonth,
        rowId: input.rowId,
        displayName: input.name,
        definitions: parsed.data.definitions.map(sanitizeDefinition),
        cells: parsed.data.cells,
      };
    },
  };
};
