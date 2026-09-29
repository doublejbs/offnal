import { ApiError } from '@google/genai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { createGeminiVisionProvider, toGeminiJsonSchema } from '@/server/vision/GeminiVisionProvider';
import { PERSON_JSON_SCHEMA, TABLE_JSON_SCHEMA, VISION_SYSTEM_PROMPT } from '@/server/vision/VisionPrompts';
import {
  getProviderErrorStatus,
  type VisionImage,
  VisionProviderError,
} from '@/server/vision/VisionProvider';

const { generateContentMock, constructorMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  class FakeGoogleGenAI {
    models = { generateContent: generateContentMock };

    constructor(options: unknown) {
      constructorMock(options);
    }
  }

  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

const IMAGE: VisionImage = { bytes: Buffer.from('fake-jpeg'), mime: ImageMimeType.JPEG };

const TABLE_OUTPUT = {
  outcome: 'ok',
  yearMonth: '2026-10',
  candidates: [
    { rowId: 'r1', name: ' 가상하나 ' },
    { rowId: 'r1', name: '중복행' },
    { rowId: 'r2', name: '가상두울' },
  ],
  definitions: [
    { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
    { code: 'E', label: '', startTime: '25:00', endTime: null, endsNextDay: null, isOff: false },
  ],
  dayHeaders: [
    { day: 1, weekday: '목' },
    { day: 32, weekday: null },
  ],
};

const PERSON_OUTPUT = {
  cells: [
    { day: 1, rawText: 'D', code: 'D', ambiguous: false },
    { day: 2, rawText: null, code: null, ambiguous: false },
  ],
  definitions: [],
};

const buildResponse = (output: unknown, overrides: Record<string, unknown> = {}) => ({
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        role: 'model',
        parts: [{ text: 'thinking about it', thought: true }, { text: JSON.stringify(output) }],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 450 },
  ...overrides,
});

const createProvider = (apiKey: string | null = 'test-key') =>
  createGeminiVisionProvider({ apiKey, model: 'gemini-test-flash', timeoutMs: 5000 });

const expectErrorCode = async (promise: Promise<unknown>, errorCode: RecognitionErrorCode) => {
  const error: unknown = await promise.catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(VisionProviderError);
  expect((error as VisionProviderError).errorCode).toBe(errorCode);

  return error as VisionProviderError;
};

describe('toGeminiJsonSchema', () => {
  it('folds nullable anyOf into type arrays and keeps the rest of the schema', () => {
    const schema = toGeminiJsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: { anyOf: [{ type: 'string', description: 'HH:mm' }, { type: 'null' }] },
        choice: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
    });

    expect(schema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: { type: ['string', 'null'], description: 'HH:mm' },
        choice: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
    });
  });

  it('leaves no null-only anyOf in the shared schemas', () => {
    const serialized = JSON.stringify([
      toGeminiJsonSchema(TABLE_JSON_SCHEMA),
      toGeminiJsonSchema(PERSON_JSON_SCHEMA),
    ]);

    expect(serialized).not.toContain('anyOf');
    expect(serialized).toContain('["string","null"]');
  });
});

describe('createGeminiVisionProvider', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    constructorMock.mockReset();
  });

  it('sends the image inline with the shared prompts and JSON schema', async () => {
    generateContentMock.mockResolvedValue(buildResponse(TABLE_OUTPUT));

    const signal = new AbortController().signal;
    const provider = createProvider();

    expect(provider.kind).toBe(VisionProviderType.GEMINI);

    await provider.recognizeTable(IMAGE, signal);

    expect(constructorMock).toHaveBeenCalledWith({ apiKey: 'test-key' });

    const [request] = generateContentMock.mock.calls[0] as [Record<string, unknown>];

    expect(request).toMatchObject({
      model: 'gemini-test-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: IMAGE.bytes.toString('base64') } },
            { text: expect.stringContaining('Read this shift roster image.') },
          ],
        },
      ],
      config: {
        systemInstruction: VISION_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: toGeminiJsonSchema(TABLE_JSON_SCHEMA),
        abortSignal: signal,
        httpOptions: { timeout: 5000 },
      },
    });
    // Thinking stays at the model default.
    expect((request.config as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it('validates the table output like the Anthropic adapter and reports usage', async () => {
    generateContentMock.mockResolvedValue(buildResponse(TABLE_OUTPUT));

    const result = await createProvider().recognizeTable(IMAGE, new AbortController().signal);

    expect(result).toEqual({
      ok: true,
      value: {
        yearMonth: '2026-10',
        candidates: [
          { rowId: 'r1', name: '가상하나' },
          { rowId: 'r2', name: '가상두울' },
        ],
        definitions: [
          {
            code: 'D',
            label: '데이',
            startTime: '07:00',
            endTime: '16:00',
            endsNextDay: false,
            isOff: false,
          },
          { code: 'E', label: 'E', startTime: null, endTime: null, endsNextDay: null, isOff: false },
        ],
        dayHeaders: [{ day: 1, weekday: '목' }],
      },
      usage: { inputTokens: 1200, outputTokens: 300, thinkingTokens: 450 },
    });
  });

  it('maps a no_table outcome to a failure result', async () => {
    generateContentMock.mockResolvedValue(buildResponse({ ...TABLE_OUTPUT, outcome: 'no_table' }));

    const result = await createProvider().recognizeTable(IMAGE, new AbortController().signal);

    expect(result).toMatchObject({ ok: false, errorCode: RecognitionErrorCode.NO_TABLE });
  });

  it('extracts one person with the person schema and quoted row data', async () => {
    generateContentMock.mockResolvedValue(
      buildResponse(PERSON_OUTPUT, { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }),
    );

    const result = await createProvider().extractPerson(
      IMAGE,
      { rowId: 'r2', name: '가상두울', yearMonth: '2026-10', definitions: [] },
      new AbortController().signal,
    );
    const [request] = generateContentMock.mock.calls[0] as [
      { contents: { parts: { text?: string }[] }[]; config: Record<string, unknown> },
    ];

    expect(request.config.responseJsonSchema).toEqual(toGeminiJsonSchema(PERSON_JSON_SCHEMA));
    expect(request.contents[0]?.parts[1]?.text).toContain('{"rowId":"r2","name":"가상두울"}');
    expect(result).toEqual({
      yearMonth: '2026-10',
      rowId: 'r2',
      displayName: '가상두울',
      definitions: [],
      cells: PERSON_OUTPUT.cells,
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
    });
  });

  it('refuses to call the API without a key', async () => {
    const provider = createProvider(null);

    await expectErrorCode(
      provider.recognizeTable(IMAGE, new AbortController().signal),
      RecognitionErrorCode.PROVIDER_NOT_CONFIGURED,
    );
    expect(constructorMock).not.toHaveBeenCalled();
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('maps rate limits and server errors to PROVIDER_ERROR and keeps the status', async () => {
    for (const status of [429, 503]) {
      generateContentMock.mockRejectedValueOnce(new ApiError({ message: 'quota', status }));

      const error = await expectErrorCode(
        createProvider().recognizeTable(IMAGE, new AbortController().signal),
        RecognitionErrorCode.PROVIDER_ERROR,
      );

      expect(getProviderErrorStatus(error)).toBe(status);
    }
  });

  it('maps aborts and SDK timeouts to PROVIDER_TIMEOUT', async () => {
    const controller = new AbortController();

    controller.abort();
    generateContentMock.mockRejectedValueOnce(new Error('aborted'));
    await expectErrorCode(
      createProvider().recognizeTable(IMAGE, controller.signal),
      RecognitionErrorCode.PROVIDER_TIMEOUT,
    );

    generateContentMock.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));
    await expectErrorCode(
      createProvider().recognizeTable(IMAGE, new AbortController().signal),
      RecognitionErrorCode.PROVIDER_TIMEOUT,
    );
  });

  it('maps blocked prompts, non-STOP finishes, invalid JSON and schema mismatches to PROVIDER_ERROR', async () => {
    const responses = [
      { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
      buildResponse(TABLE_OUTPUT, {
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"outcome":' }] } }],
      }),
      buildResponse(TABLE_OUTPUT, {
        candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
      }),
      buildResponse(TABLE_OUTPUT, {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }],
      }),
      buildResponse({ outcome: 'ok', candidates: 'wrong' }),
      { candidates: [] },
    ];

    for (const response of responses) {
      generateContentMock.mockResolvedValueOnce(response);
      await expectErrorCode(
        createProvider().recognizeTable(IMAGE, new AbortController().signal),
        RecognitionErrorCode.PROVIDER_ERROR,
      );
    }
  });
});
