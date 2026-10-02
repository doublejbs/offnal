import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

import { OcrEvalPipeline } from '@/domain/enums/OcrEvalPipeline';
import { type EvalArgs } from '@/server/vision/eval/EvalArgs';
import { ModelUnavailableError } from '@/server/vision/eval/EvalCallRetry';
import { createDebugSink } from '@/server/vision/eval/EvalDebugImages';
import {
  OCR_MODEL_LABEL,
  readSampleWithOcr,
  runOcrPipeline,
  runOcrThenAiPipeline,
} from '@/server/vision/eval/EvalOcrRunner';
import { type OcrSummary, summarizeOcr } from '@/server/vision/eval/EvalOcrSummary';
import { createProvider } from '@/server/vision/eval/EvalProviders';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import { type EvalCallContext, type EvalRun } from '@/server/vision/eval/EvalTypes';
import { createTesseractOcrProvider } from '@/server/vision/ocr/TesseractOcrProvider';
import { decodeRaw } from '@/server/vision/RawImageCodec';
import { type VisionImage, type VisionProvider } from '@/server/vision/VisionProvider';

export type OcrEvalSample = { sample: EvalSample; image: VisionImage; people: string[] };

export type OcrEvalResult = {
  runs: EvalRun[];
  summaries: OcrSummary[];
  sampleSummaries: OcrSummary[];
  /** Models skipped for `ocr-then-ai` (label → reason). */
  skipped: Record<string, string>;
};

type Target = { label: string; provider: VisionProvider; context: EvalCallContext };

const formatCellCounts = (runs: EvalRun[]): string =>
  runs
    .flatMap((run) => run.people)
    .map((person) => `${person.score.correctDays}/${person.score.totalDays}`)
    .join(' ');

/**
 * AI-free pipelines of the eval (Spec §20): each photo is read once per repeat with OCR (full-resolution
 * original, EXIF rotation applied), then scored as `ocr` and, per model, as `ocr-then-ai`.
 */
export const runOcrEval = async (
  args: EvalArgs,
  samples: OcrEvalSample[],
  debugRoot: string,
  log: (line: string) => void,
): Promise<OcrEvalResult> => {
  const ocr = createTesseractOcrProvider();
  const runs: EvalRun[] = [];
  const skipped: Record<string, string> = {};
  const targets: Target[] = [];

  if (args.ocrPipelines.includes(OcrEvalPipeline.OCR_THEN_AI)) {
    for (const target of args.models) {
      const provider = createProvider(target);

      if (typeof provider === 'string') {
        skipped[target.label] = provider;
        continue;
      }

      targets.push({ label: target.label, provider, context: { target, log, state: { calls: 0 } } });
    }
  }

  try {
    for (let repeat = 1; repeat <= args.repeat; repeat += 1) {
      for (const { sample, image, people } of samples) {
        const source = await decodeRaw(
          await sharp(await readFile(sample.imagePath))
            .rotate()
            .toBuffer(),
        );
        const debug = createDebugSink(debugRoot, OCR_MODEL_LABEL, sample.id, repeat);
        const result = await readSampleWithOcr(ocr, source, debug);
        const input = { sample, people, repeat, result, debug };

        log(
          `[ocr] ${sample.id} #${repeat} ${result.ok ? `rows ${result.table.rows.length}, days ${result.table.dayCount}` : `FAILED ${result.failure}`} ${(result.latencyMs / 1000).toFixed(1)}s`,
        );

        if (args.ocrPipelines.includes(OcrEvalPipeline.OCR)) {
          const run = await runOcrPipeline(input);

          runs.push(run);
          log(`[ocr] ${sample.id} #${repeat} ocr ${formatCellCounts([run])}`);
        }

        for (const target of targets.filter((item) => skipped[item.label] === undefined)) {
          try {
            const run = await runOcrThenAiPipeline({
              ...input,
              context: target.context,
              provider: target.provider,
              image,
              debug: createDebugSink(debugRoot, `${target.label}-ocr-then-ai`, sample.id, repeat),
            });

            runs.push(run);
            log(`[${target.label}] ${sample.id} #${repeat} ocr-then-ai ${formatCellCounts([run])}`);
          } catch (error: unknown) {
            if (!(error instanceof ModelUnavailableError)) {
              throw error;
            }

            skipped[target.label] = `model unavailable for this key, ${error.summary}`;
          }
        }
      }
    }
  } finally {
    await ocr.terminate();
  }

  const combos = [
    ...(args.ocrPipelines.includes(OcrEvalPipeline.OCR)
      ? [{ pipeline: OcrEvalPipeline.OCR, model: OCR_MODEL_LABEL }]
      : []),
    ...targets.map((target) => ({ pipeline: OcrEvalPipeline.OCR_THEN_AI, model: target.label })),
  ];
  const pick = (pipeline: OcrEvalPipeline, model: string, sampleId: string | null) =>
    runs.filter(
      (run) =>
        run.pipeline === pipeline && run.model === model && (sampleId === null || run.sampleId === sampleId),
    );

  return {
    runs,
    summaries: combos.map(({ pipeline, model }) =>
      summarizeOcr(pipeline, model, pick(pipeline, model, null)),
    ),
    sampleSummaries: samples.flatMap(({ sample }) =>
      combos.map(({ pipeline, model }) =>
        summarizeOcr(pipeline, model, pick(pipeline, model, sample.id), sample.id),
      ),
    ),
    skipped,
  };
};
