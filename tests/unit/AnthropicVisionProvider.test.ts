import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { createAnthropicVisionProvider } from '@/server/vision/AnthropicVisionProvider';
import {
  REFERENCE_IMAGE_LABEL,
  ROW_LOCATION_JSON_SCHEMA,
  STRIP_IMAGE_LABEL,
  STRIP_PERSON_JSON_SCHEMA,
  TABLE_JSON_SCHEMA,
  VISION_SYSTEM_PROMPT,
} from '@/server/vision/VisionPrompts';
import { type VisionImage, VisionProviderError } from '@/server/vision/VisionProvider';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();

  class FakeAnthropic {
    static APIUserAbortError = actual.default.APIUserAbortError;
    static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;

    beta = { messages: { create: createMock } };
  }

  return { ...actual, default: FakeAnthropic };
});

const IMAGE: VisionImage = { bytes: Buffer.from('warped-jpeg'), mime: ImageMimeType.JPEG };
const STRIP: VisionImage = { bytes: Buffer.from('strip-jpeg'), mime: ImageMimeType.JPEG };

const buildMessage = (output: unknown, stopReason = 'end_turn') => ({
  stop_reason: stopReason,
  content: [{ type: 'text', text: JSON.stringify(output) }],
  usage: { input_tokens: 900, output_tokens: 120 },
});

const createProvider = () =>
  createAnthropicVisionProvider({
    apiKey: 'test-key',
    model: 'claude-test',
    effort: VisionEffort.MEDIUM,
    timeoutMs: 5000,
  });

type CreateRequest = {
  output_config: { effort: string; format: { schema: unknown } };
  system: string;
  messages: { role: string; content: Record<string, unknown>[] }[];
};

const lastRequest = (): CreateRequest => (createMock.mock.calls.at(-1) as [CreateRequest])[0];

describe('createAnthropicVisionProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('sends a single image before the prompt for pass 1 with the grid in the schema', async () => {
    createMock.mockResolvedValue(
      buildMessage({
        outcome: 'ok',
        yearMonth: '2026-10',
        candidates: [{ rowId: 'r1', name: '가상하나' }],
        definitions: [],
        dayHeaders: [],
        grid: null,
      }),
    );

    const result = await createProvider().recognizeTable(IMAGE, new AbortController().signal);
    const request = lastRequest();

    expect(result.ok && result.value.grid).toBeNull();
    expect(request.system).toBe(VISION_SYSTEM_PROMPT);
    expect(request.output_config.format.schema).toBe(TABLE_JSON_SCHEMA);
    expect(request.messages[0]?.content.map((block) => block.type)).toEqual(['image', 'text']);
    expect(request.messages[0]?.content[1]?.text).toContain('Also return grid:');
  });

  it('locates a row at low effort with the row-location schema', async () => {
    createMock.mockResolvedValue(buildMessage({ top: 300, bottom: 340, headerBottom: null }));

    const result = await createProvider().locateRow(
      IMAGE,
      { rowId: 'r2', name: '가상두울' },
      new AbortController().signal,
    );
    const request = lastRequest();

    expect(result).toEqual({
      band: { top: 300, bottom: 340, headerBottom: null },
      usage: { inputTokens: 900, outputTokens: 120, thinkingTokens: null },
    });
    expect(request.output_config.effort).toBe('low');
    expect(request.output_config.format.schema).toBe(ROW_LOCATION_JSON_SCHEMA);
    expect(request.messages[0]?.content[1]?.text).toContain('{"rowId":"r2","name":"가상두울"}');
  });

  it('sends the strip and the reference as two labeled base64 images', async () => {
    const cells = Array.from({ length: 31 }, (_, index) => ({
      day: 31 - index,
      rawText: null,
      code: null,
      ambiguous: false,
    }));

    createMock.mockResolvedValue(buildMessage({ cells }));

    const result = await createProvider().extractPersonFromStrip(
      STRIP,
      IMAGE,
      { rowId: 'r2', name: '가상두울', yearMonth: '2026-10', definitions: [] },
      new AbortController().signal,
    );
    const request = lastRequest();

    expect(request.messages[0]?.content).toEqual([
      { type: 'text', text: STRIP_IMAGE_LABEL },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: STRIP.bytes.toString('base64') },
      },
      { type: 'text', text: REFERENCE_IMAGE_LABEL },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: IMAGE.bytes.toString('base64') },
      },
      { type: 'text', text: expect.stringContaining('cells[0] is day 1') },
    ]);
    expect(request.output_config).toMatchObject({
      effort: 'medium',
      format: { schema: STRIP_PERSON_JSON_SCHEMA },
    });
    // Position is the day; null cells stay null (never OFF).
    expect(result.cells.map((cell) => cell.day)).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
    expect(result.cells.every((cell) => cell.code === null && !cell.ambiguous)).toBe(true);
  });

  it('maps refusals and schema mismatches of the new calls to PROVIDER_ERROR', async () => {
    createMock.mockResolvedValueOnce(buildMessage({ top: 1, bottom: 2, headerBottom: null }, 'refusal'));
    createMock.mockResolvedValueOnce(buildMessage({ cells: 'none' }));

    const provider = createProvider();
    const refused = await provider
      .locateRow(IMAGE, { rowId: 'r1', name: 'x' }, new AbortController().signal)
      .catch((error: unknown) => error);
    const mismatch = await provider
      .extractPersonFromStrip(
        STRIP,
        IMAGE,
        { rowId: 'r1', name: 'x', yearMonth: '2026-10', definitions: [] },
        new AbortController().signal,
      )
      .catch((error: unknown) => error);

    for (const error of [refused, mismatch]) {
      expect(error).toBeInstanceOf(VisionProviderError);
      expect((error as VisionProviderError).errorCode).toBe(RecognitionErrorCode.PROVIDER_ERROR);
    }
  });
});
