import {
  FinishReason,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  type Part,
} from '@google/genai';

import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import {
  parsePersonOutput,
  parseRowLocationOutput,
  parseStripPersonOutput,
  parseTableOutput,
} from '@/server/vision/VisionOutputParser';
import {
  buildPersonUserPrompt,
  PERSON_JSON_SCHEMA,
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
  type VisionUsage,
} from '@/server/vision/VisionProvider';
import {
  buildRowLocationPrompt,
  buildStripPersonPrompt,
  REFERENCE_IMAGE_LABEL,
  ROW_LOCATION_JSON_SCHEMA,
  STRIP_IMAGE_LABEL,
  STRIP_PERSON_JSON_SCHEMA,
} from '@/server/vision/VisionRowPrompts';

/** Output cap including thinking tokens (Gemini counts thoughts toward maxOutputTokens). */
const MAX_OUTPUT_TOKENS = 32000;

export type GeminiVisionConfig = {
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

type JsonSchemaNode = Record<string, unknown>;

const isSchemaNode = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNullSchema = (value: unknown): boolean => isSchemaNode(value) && value.type === 'null';

/**
 * Derives the Gemini `responseJsonSchema` from the shared schema in one place: the Gemini docs express
 * nullable values as `type: [T, 'null']`, so `anyOf: [T, { type: 'null' }]` is folded into that form.
 * Everything else (description, enum, required, additionalProperties, items) is supported as-is.
 */
export const toGeminiJsonSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(toGeminiJsonSchema);
  }

  if (!isSchemaNode(schema)) {
    return schema;
  }

  const { anyOf } = schema;

  if (Array.isArray(anyOf) && anyOf.length === 2 && anyOf.some(isNullSchema)) {
    const valueSchema = anyOf.find((option) => !isNullSchema(option));

    if (isSchemaNode(valueSchema) && typeof valueSchema.type === 'string') {
      const { anyOf: _dropped, ...rest } = schema;

      return toGeminiJsonSchema({ ...rest, ...valueSchema, type: [valueSchema.type, 'null'] });
    }
  }

  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, toGeminiJsonSchema(value)]));
};

const GEMINI_TABLE_SCHEMA = toGeminiJsonSchema(TABLE_JSON_SCHEMA);
const GEMINI_PERSON_SCHEMA = toGeminiJsonSchema(PERSON_JSON_SCHEMA);
const GEMINI_STRIP_PERSON_SCHEMA = toGeminiJsonSchema(STRIP_PERSON_JSON_SCHEMA);
const GEMINI_ROW_LOCATION_SCHEMA = toGeminiJsonSchema(ROW_LOCATION_JSON_SCHEMA);

/** Optional text label, then the inline image (labels tell multi-image prompts which image is which). */
const toImageParts = ({ label, image }: LabeledVisionImage): Part[] => [
  ...(label === null ? [] : [{ text: label }]),
  { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } },
];

const toUsage = (metadata: GenerateContentResponseUsageMetadata | undefined): VisionUsage => ({
  inputTokens: metadata?.promptTokenCount ?? 0,
  outputTokens: metadata?.candidatesTokenCount ?? 0,
  thinkingTokens: metadata?.thoughtsTokenCount ?? 0,
});

/** Visible answer text of the first candidate (thought summaries excluded). Throws when blocked/cut off. */
const readOutputText = (response: GenerateContentResponse): string => {
  if (response.promptFeedback?.blockReason) {
    throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }

  const [candidate] = response.candidates ?? [];

  // STOP is the only natural finish; MAX_TOKENS, SAFETY, RECITATION, … leave partial or no JSON.
  if (!candidate || (candidate.finishReason && candidate.finishReason !== FinishReason.STOP)) {
    throw new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR);
  }

  return (candidate.content?.parts ?? [])
    .flatMap((part) => (typeof part.text === 'string' && !part.thought ? [part.text] : []))
    .join('');
};

const isAbortLike = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const mapProviderError = (error: unknown, signal: AbortSignal): VisionProviderError => {
  if (error instanceof VisionProviderError) {
    return error;
  }

  if (signal.aborted || isAbortLike(error)) {
    return new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT, { cause: error });
  }

  // ApiError (401/403/429/5xx…), JSON/zod failures and anything else. `cause` keeps the status.
  return new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR, { cause: error });
};

/** Gemini vision adapter (official @google/genai SDK). Never logs image data or recognized names. */
export const createGeminiVisionProvider = (config: GeminiVisionConfig): VisionProvider => {
  // One client per provider instance (the provider itself is cached by VisionFactory).
  const client = config.apiKey ? new GoogleGenAI({ apiKey: config.apiKey }) : null;

  const callModel = async (
    images: LabeledVisionImage[],
    text: string,
    schema: unknown,
    signal: AbortSignal,
  ): Promise<VisionModelCallResult> => {
    if (!client) {
      throw new VisionProviderError(RecognitionErrorCode.PROVIDER_NOT_CONFIGURED);
    }

    try {
      const response = await client.models.generateContent({
        model: config.model,
        contents: [
          {
            role: 'user',
            parts: [...images.flatMap(toImageParts), { text }],
          },
        ],
        config: {
          systemInstruction: VISION_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: signal,
          httpOptions: { timeout: config.timeoutMs },
        },
      });
      const output = readOutputText(response);

      return { output: JSON.parse(output) as unknown, usage: toUsage(response.usageMetadata) };
    } catch (error: unknown) {
      throw mapProviderError(error, signal);
    }
  };

  return {
    kind: VisionProviderType.GEMINI,
    recognizeTable: async (image, signal): Promise<VisionTableResult> => {
      const { output, usage } = await callModel(
        [{ label: null, image }],
        TABLE_USER_PROMPT,
        GEMINI_TABLE_SCHEMA,
        signal,
      );

      return { ...parseTableOutput(output), usage };
    },
    extractPerson: async (image, input, signal): Promise<VisionPersonResult> => {
      const { output, usage } = await callModel(
        [{ label: null, image }],
        buildPersonUserPrompt(input),
        GEMINI_PERSON_SCHEMA,
        signal,
      );

      return { ...parsePersonOutput(output, input), usage };
    },
    locateRow: async (image, input, signal): Promise<VisionRowLocationResult> => {
      const { output, usage } = await callModel(
        [{ label: null, image }],
        buildRowLocationPrompt(input),
        GEMINI_ROW_LOCATION_SCHEMA,
        signal,
      );

      return { ...parseRowLocationOutput(output), usage };
    },
    extractPersonFromStrip: async (strip, reference, input, signal): Promise<VisionPersonResult> => {
      const { output, usage } = await callModel(
        [
          { label: STRIP_IMAGE_LABEL, image: strip },
          { label: REFERENCE_IMAGE_LABEL, image: reference },
        ],
        buildStripPersonPrompt(input),
        GEMINI_STRIP_PERSON_SCHEMA,
        signal,
      );

      return { ...parseStripPersonOutput(output, input), usage };
    },
  };
};
