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
import {
  REFERENCE_IMAGE_LABEL,
  ROW_LOCATION_JSON_SCHEMA,
  STRIP_IMAGE_LABEL,
  STRIP_PERSON_JSON_SCHEMA,
} from '@/server/vision/VisionRowPrompts';

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
        grid: null,
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
      // No rowName in the output: accepted, but the row is not verified.
      reading: { rowName: null, targetInStrip: null, sameNameOrdinal: null },
      usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
    });
  });

  it('keeps valid grid corners and drops malformed ones without failing pass 1', async () => {
    const grid = {
      topLeft: { x: 160, y: 260 },
      topRight: { x: 895, y: 212 },
      bottomRight: { x: 957, y: 695 },
      bottomLeft: { x: 140, y: 720 },
    };

    generateContentMock.mockResolvedValueOnce(buildResponse({ ...TABLE_OUTPUT, grid }));
    generateContentMock.mockResolvedValueOnce(
      buildResponse({ ...TABLE_OUTPUT, grid: { ...grid, topLeft: { x: 'left', y: 1 } } }),
    );

    const withGrid = await createProvider().recognizeTable(IMAGE, new AbortController().signal);
    const malformed = await createProvider().recognizeTable(IMAGE, new AbortController().signal);

    expect(withGrid.ok && withGrid.value.grid).toEqual(grid);
    expect(malformed.ok && malformed.value.grid).toBeNull();
    expect(JSON.stringify(toGeminiJsonSchema(TABLE_JSON_SCHEMA))).toContain(
      '"grid":{"type":["object","null"]',
    );
  });

  it('locates a row with the short row-location schema', async () => {
    generateContentMock.mockResolvedValueOnce(buildResponse({ top: 410, bottom: 452, headerBottom: 118 }));
    generateContentMock.mockResolvedValueOnce(buildResponse({ top: null, bottom: null, headerBottom: 118 }));

    const provider = createProvider();
    const found = await provider.locateRow(
      IMAGE,
      { rowId: 'r3', name: '가상하나' },
      new AbortController().signal,
    );
    const missing = await provider.locateRow(
      IMAGE,
      { rowId: 'r3', name: '가상하나' },
      new AbortController().signal,
    );
    const [request] = generateContentMock.mock.calls[0] as [
      { contents: { parts: { text?: string; inlineData?: unknown }[] }[]; config: Record<string, unknown> },
    ];

    expect(found).toEqual({
      band: { top: 410, bottom: 452, headerBottom: 118 },
      rowName: null,
      usage: { inputTokens: 1200, outputTokens: 300, thinkingTokens: 450 },
    });
    expect(missing.band).toBeNull();
    expect(request.config.responseJsonSchema).toEqual(toGeminiJsonSchema(ROW_LOCATION_JSON_SCHEMA));
    expect(request.config.systemInstruction).toBe(VISION_SYSTEM_PROMPT);
    expect(request.contents[0]?.parts).toHaveLength(2);
    expect(request.contents[0]?.parts[1]?.text).toContain('{"rowId":"r3","name":"가상하나"}');

    generateContentMock.mockResolvedValueOnce(buildResponse({ top: '410' }));
    await expectErrorCode(
      provider.locateRow(IMAGE, { rowId: 'r3', name: '가상하나' }, new AbortController().signal),
      RecognitionErrorCode.PROVIDER_ERROR,
    );
  });

  it('sends the strip and the reference as two labeled inline images and aligns the cells', async () => {
    const strip: VisionImage = { bytes: Buffer.from('strip-jpeg'), mime: ImageMimeType.JPEG };
    const cells = Array.from({ length: 30 }, (_, index) => ({
      day: index + 1,
      rawText: 'D',
      code: 'D',
      ambiguous: false,
    }));

    generateContentMock.mockResolvedValue(buildResponse({ cells }));

    const legend = [
      { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
    ];
    const result = await createProvider().extractPersonFromStrip(
      strip,
      IMAGE,
      { rowId: 'r2', name: '가상두울', yearMonth: '2026-10', definitions: legend },
      new AbortController().signal,
    );
    const [request] = generateContentMock.mock.calls[0] as [
      { contents: { parts: Record<string, unknown>[] }[]; config: Record<string, unknown> },
    ];

    expect(request.contents[0]?.parts).toEqual([
      { text: STRIP_IMAGE_LABEL },
      { inlineData: { mimeType: 'image/jpeg', data: strip.bytes.toString('base64') } },
      { text: REFERENCE_IMAGE_LABEL },
      { inlineData: { mimeType: 'image/jpeg', data: IMAGE.bytes.toString('base64') } },
      { text: expect.stringContaining('Return exactly 31 cells in order') },
    ]);
    expect(request.config).toMatchObject({
      systemInstruction: VISION_SYSTEM_PROMPT,
      responseJsonSchema: toGeminiJsonSchema(STRIP_PERSON_JSON_SCHEMA),
    });
    // October has 31 days: 30 cells → day 31 missing, the rest flagged for review; pass-1 legend kept.
    expect(result.cells).toHaveLength(30);
    expect(result.cells.every((cell) => cell.ambiguous)).toBe(true);
    expect(result.definitions).toEqual(legend);
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
