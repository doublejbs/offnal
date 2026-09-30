import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ImageMimeType } from '@/domain/enums/ImageMimeType';
import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';
import { VisionPipelineFallback } from '@/domain/enums/VisionPipelineFallback';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionPipelineRoute } from '@/domain/enums/VisionPipelineRoute';
import { VisionPipelineStep } from '@/domain/enums/VisionPipelineStep';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type GridCorners } from '@/domain/types/GridCorners';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import {
  extractPersonWithPipeline,
  type PipelineCallRunner,
  preparePipelineImage,
} from '@/server/vision/VisionPipeline';
import {
  type PersonExtractionInput,
  type RowBand,
  type VisionImage,
  type VisionProvider,
  VisionProviderError,
} from '@/server/vision/VisionProvider';

const PASS_ONE_LEGEND: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
];

const INPUT: PersonExtractionInput = {
  rowId: 'r3',
  name: '가상하나',
  yearMonth: '2026-10',
  definitions: PASS_ONE_LEGEND,
};

const GRID: GridCorners = {
  topLeft: { x: 160, y: 260 },
  topRight: { x: 895, y: 212 },
  bottomRight: { x: 957, y: 695 },
  bottomLeft: { x: 140, y: 720 },
};

const TINY_GRID: GridCorners = {
  topLeft: { x: 100, y: 100 },
  topRight: { x: 200, y: 100 },
  bottomRight: { x: 200, y: 200 },
  bottomLeft: { x: 100, y: 200 },
};

let original: VisionImage;

beforeAll(async () => {
  const bytes = await sharp({
    create: { width: 1536, height: 1152, channels: 3, background: '#f4f4f4' },
  })
    .jpeg()
    .toBuffer();

  original = { bytes, mime: ImageMimeType.JPEG };
});

const widthOf = async (image: VisionImage) => (await sharp(image.bytes).metadata()).width;

type FakeOptions = {
  band?: RowBand | null | Error;
};

/** Records which image each call saw; returns 31 'D' cells (legend 'X' that pass 2 cannot see). */
const createFakeProvider = (options: FakeOptions = {}) => {
  const person = (input: PersonExtractionInput) => ({
    yearMonth: input.yearMonth,
    rowId: input.rowId,
    displayName: input.name,
    definitions: [{ code: 'X', label: 'X', startTime: null, endTime: null, endsNextDay: null, isOff: false }],
    cells: Array.from({ length: 31 }, (_, index) => ({
      day: index + 1,
      rawText: 'D',
      code: 'D',
      ambiguous: false,
    })),
    usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
  });
  const extractPerson = vi.fn(async (_image: VisionImage, input: PersonExtractionInput) => person(input));
  const locateRow = vi.fn(async () => {
    if (options.band instanceof Error) {
      throw options.band;
    }

    return { band: options.band === undefined ? null : options.band };
  });
  const extractPersonFromStrip = vi.fn(
    async (_strip: VisionImage, _reference: VisionImage, input: PersonExtractionInput) => ({
      ...person(input),
      definitions: input.definitions,
    }),
  );
  const provider: VisionProvider = {
    kind: VisionProviderType.MOCK,
    recognizeTable: vi.fn(),
    extractPerson,
    locateRow,
    extractPersonFromStrip,
  };

  return { provider, extractPerson, locateRow, extractPersonFromStrip };
};

const createRunner = () => {
  const steps: VisionPipelineStep[] = [];
  const runCall: PipelineCallRunner = async (step, run) => {
    steps.push(step);

    return run(new AbortController().signal);
  };

  return { steps, runCall };
};

describe('preparePipelineImage', () => {
  it('never warps in baseline mode', async () => {
    const prepared = await preparePipelineImage(VisionPipelineMode.BASELINE, original, GRID);

    expect(prepared).toMatchObject({ warp: null, fallback: null });
  });

  it('falls back to the original without corners or with an unusable quad', async () => {
    expect(await preparePipelineImage(VisionPipelineMode.WARP_STRIP, original, null)).toMatchObject({
      warp: null,
      fallback: VisionPipelineFallback.NO_GRID,
    });
    expect(await preparePipelineImage(VisionPipelineMode.WARP_STRIP, original, undefined)).toMatchObject({
      warp: null,
      fallback: VisionPipelineFallback.NO_GRID,
    });
    expect(await preparePipelineImage(VisionPipelineMode.WARP, original, TINY_GRID)).toMatchObject({
      warp: null,
      fallback: VisionPipelineFallback.INVALID_GRID,
    });
  });

  it('warps with usable corners', async () => {
    const prepared = await preparePipelineImage(VisionPipelineMode.WARP, original, GRID);

    expect(prepared.fallback).toBeNull();
    expect(prepared.warp?.image.mime).toBe(ImageMimeType.JPEG);
  });
});

describe('extractPersonWithPipeline', () => {
  it('uses the original image and pass-2 legend when there is no grid', async () => {
    const fake = createFakeProvider();
    const runner = createRunner();
    const prepared = await preparePipelineImage(VisionPipelineMode.WARP_STRIP, original, null);
    const result = await extractPersonWithPipeline(fake.provider, prepared, INPUT, runner.runCall);

    expect(result).toMatchObject({
      route: VisionPipelineRoute.ORIGINAL,
      fallback: VisionPipelineFallback.NO_GRID,
    });
    expect(fake.extractPerson.mock.calls[0]?.[0]).toBe(original);
    expect(fake.locateRow).not.toHaveBeenCalled();
    expect(runner.steps).toEqual([VisionPipelineStep.EXTRACT]);
    expect(result.extraction.definitions.map((definition) => definition.code)).toEqual(['X']);
    expect(result.extraction).not.toHaveProperty('usage');
  });

  it('extracts from the warped table in warp mode and keeps the pass-1 legend', async () => {
    const fake = createFakeProvider();
    const runner = createRunner();
    const prepared = await preparePipelineImage(VisionPipelineMode.WARP, original, GRID);
    const result = await extractPersonWithPipeline(fake.provider, prepared, INPUT, runner.runCall);
    const sentImage = fake.extractPerson.mock.calls[0]?.[0];

    expect(result).toMatchObject({ route: VisionPipelineRoute.WARPED, fallback: null });
    expect(sentImage).toBe(prepared.warp?.image);
    expect(await widthOf(sentImage!)).toBe(prepared.warp?.raw.width);
    expect(result.extraction.definitions).toEqual(PASS_ONE_LEGEND);
    expect(fake.locateRow).not.toHaveBeenCalled();
  });

  it('falls back to the warped table when the row is not found or the band is implausible', async () => {
    for (const [band, fallback] of [
      [null, VisionPipelineFallback.ROW_NOT_FOUND],
      [{ top: 100, bottom: 900, headerBottom: null }, VisionPipelineFallback.INVALID_ROW],
      [new VisionProviderError(RecognitionErrorCode.PROVIDER_ERROR), VisionPipelineFallback.LOCATE_FAILED],
    ] as const) {
      const fake = createFakeProvider({ band });
      const runner = createRunner();
      const prepared = await preparePipelineImage(VisionPipelineMode.WARP_STRIP, original, GRID);
      const result = await extractPersonWithPipeline(fake.provider, prepared, INPUT, runner.runCall);

      expect(result).toMatchObject({ route: VisionPipelineRoute.WARPED, fallback, strip: null });
      expect(runner.steps).toEqual([VisionPipelineStep.LOCATE_ROW, VisionPipelineStep.EXTRACT]);
      expect(fake.extractPerson.mock.calls[0]?.[0]).toBe(prepared.warp?.image);
      expect(fake.extractPersonFromStrip).not.toHaveBeenCalled();
    }
  });

  it('propagates a timeout of the locate call instead of falling back', async () => {
    const fake = createFakeProvider({ band: new VisionProviderError(RecognitionErrorCode.PROVIDER_TIMEOUT) });
    const prepared = await preparePipelineImage(VisionPipelineMode.WARP_STRIP, original, GRID);

    await expect(
      extractPersonWithPipeline(fake.provider, prepared, INPUT, createRunner().runCall),
    ).rejects.toMatchObject({ errorCode: RecognitionErrorCode.PROVIDER_TIMEOUT });
    expect(fake.extractPerson).not.toHaveBeenCalled();
  });

  it('sends the header+row strip first and the warped table as reference', async () => {
    const band = { top: 400, bottom: 450, headerBottom: 120 };
    const fake = createFakeProvider({ band });
    const runner = createRunner();
    const prepared = await preparePipelineImage(VisionPipelineMode.WARP_STRIP, original, GRID);
    const result = await extractPersonWithPipeline(fake.provider, prepared, INPUT, runner.runCall);
    const [strip, reference, input] = fake.extractPersonFromStrip.mock.calls[0]!;

    expect(result).toMatchObject({ route: VisionPipelineRoute.STRIP, fallback: null, band });
    expect(runner.steps).toEqual([VisionPipelineStep.LOCATE_ROW, VisionPipelineStep.EXTRACT_STRIP]);
    expect(fake.locateRow.mock.calls[0]).toEqual([
      prepared.warp?.image,
      { rowId: 'r3', name: '가상하나' },
      expect.any(AbortSignal),
    ]);
    expect(reference).toBe(prepared.warp?.image);
    expect(input).toEqual(INPUT);
    expect(strip).toBe(result.strip);

    const metadata = await sharp(strip.bytes).metadata();

    // Upscaled (≤ 2×, long edge ≤ 2576) and much shorter than the warped table.
    expect(metadata.width).toBeGreaterThan(prepared.warp!.raw.width);
    expect(metadata.height).toBeLessThan(prepared.warp!.raw.height);
    expect(fake.extractPerson).not.toHaveBeenCalled();
  });
});
