/**
 * Vision model comparison eval (Spec §13, §15, §20):
 * `pnpm vision:eval -- --dir .data/eval --models a,b --pipeline baseline,warp,warp-strip --repeat 2`, and the
 * AI-free pipelines `--pipeline ocr` (no model needed) / `ocr-then-ai` (OCR first, AI fallback per person).
 * Runs the real flow per model × sample (pass 1 once, pass 2 per pipeline), scores it against truth.json
 * and writes `.data/eval/results/<timestamp>.json` plus debug images (grid overlay, warped table, strips)
 * under `.data/eval/debug/<timestamp>/`. Eval images, truths, results and debug images stay out of Git.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GeminiTier } from '@/domain/enums/GeminiTier';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { type VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import {
  type EvalModelTarget,
  parseEvalArgs,
  resolveDebugDir,
  resolveResultsDir,
} from '@/server/vision/eval/EvalArgs';
import { ModelUnavailableError } from '@/server/vision/eval/EvalCallRetry';
import { createDebugSink } from '@/server/vision/eval/EvalDebugImages';
import { runOcrEval } from '@/server/vision/eval/EvalOcrMain';
import { formatOcrTable } from '@/server/vision/eval/EvalOcrSummary';
import { createProvider, readEnv } from '@/server/vision/eval/EvalProviders';
import {
  formatCellErrors,
  formatPersonTable,
  formatSampleTable,
  formatSummaryTable,
} from '@/server/vision/eval/EvalReport';
import { runSample } from '@/server/vision/eval/EvalRunner';
import {
  type ModelSummary,
  personKey,
  sortSummaries,
  summarizeModel,
} from '@/server/vision/eval/EvalSummary';
import { type EvalSample, loadEvalSamples } from '@/server/vision/eval/EvalTruth';
import { type EvalRun } from '@/server/vision/eval/EvalTypes';
import { MODEL_PRICES, MODEL_PRICES_AS_OF } from '@/server/vision/eval/ModelPrices';
import { prepareImageForVision } from '@/server/vision/VisionImagePreparer';
import { type VisionImage } from '@/server/vision/VisionProvider';

const log = (line: string): void => {
  console.error(line);
};

type PreparedSample = {
  sample: EvalSample;
  image: VisionImage;
  people: string[];
};

type ModelResult = {
  runs: EvalRun[];
  skipped: string | null;
};

type RunOptions = {
  repeat: number;
  pipelines: VisionPipelineMode[];
  debugRoot: string;
};

/** Models run in parallel (separate quotas); calls within one model run sequentially. */
const runModel = async (
  target: EvalModelTarget,
  samples: PreparedSample[],
  options: RunOptions,
): Promise<ModelResult> => {
  const { repeat, pipelines, debugRoot } = options;
  const provider = createProvider(target);

  if (typeof provider === 'string') {
    log(`[${target.label}] skipped: ${provider}`);

    return { runs: [], skipped: provider };
  }

  const runs: EvalRun[] = [];
  const context = { target, log, state: { calls: 0 } };

  try {
    for (let index = 1; index <= repeat; index += 1) {
      for (const { sample, image, people } of samples) {
        runs.push(
          ...(await runSample({
            context,
            provider,
            sample,
            image,
            people,
            repeat: index,
            pipelines,
            debug: createDebugSink(debugRoot, target.label, sample.id, index),
          })),
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof ModelUnavailableError) {
      log(`[${target.label}] skipped: model unavailable for this key (${error.message})`);

      return { runs, skipped: `model unavailable for this key, ${error.summary}` };
    }

    throw error;
  }

  return { runs, skipped: null };
};

const prepareSamples = async (
  samples: EvalSample[],
  peopleFilter: string[] | null,
): Promise<PreparedSample[]> =>
  Promise.all(
    samples.map(async (sample) => {
      const scored = Object.keys(sample.truth.people);
      const people = peopleFilter ? scored.filter((name) => peopleFilter.includes(name)) : scored;

      return { sample, image: await prepareImageForVision(await readFile(sample.imagePath)), people };
    }),
  );

/** Per-person rows of the OCR pipelines for the correct-days table. */
const ocrPersonSummaries = (runs: EvalRun[]): ModelSummary[] => {
  const keys = [...new Set(runs.map((run) => `${run.pipeline}\u0000${run.model}`))];

  return keys.map((key) => {
    const [pipeline, model] = key.split('\u0000') as [EvalRun['pipeline'], string];

    return summarizeModel(
      model,
      runs.filter((run) => run.pipeline === pipeline && run.model === model),
      null,
      pipeline,
    );
  });
};

const main = async (): Promise<void> => {
  const args = parseEvalArgs(process.argv.slice(2));
  // Fail before any paid/quota-limited call if results would land outside .data/.
  const resultsDir = resolveResultsDir(args.dir, process.cwd());
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/gu, '-');
  const debugRoot = path.join(resolveDebugDir(args.dir, process.cwd()), runId);

  if (
    args.models.some((target) => target.provider === VisionProviderType.GEMINI) &&
    readEnv('GEMINI_TIER') !== GeminiTier.PAID
  ) {
    log(
      'WARNING: GEMINI_TIER is not paid — free-tier inputs may be used for training. Use only fictional or consented images, never real names/photos.',
    );
  }

  const samples = await loadEvalSamples(args.dir);

  if (samples.length === 0) {
    throw new Error(`No samples (sub-folders with truth.json) in ${args.dir}`);
  }

  const prepared = await prepareSamples(samples, args.people);
  const people = prepared.flatMap(({ sample, people: names }) =>
    names.map((name) => personKey(sample.id, name)),
  );

  log(
    `vision eval: ${samples.length} sample(s), ${people.length} person(s), ${args.models.length} model(s), pipelines ${[...args.pipelines, ...args.ocrPipelines].join(',')}, repeat ${args.repeat}`,
  );

  const results =
    args.pipelines.length === 0
      ? []
      : await Promise.all(
          args.models.map((target) =>
            runModel(target, prepared, { repeat: args.repeat, pipelines: args.pipelines, debugRoot }),
          ),
        );
  const ocr = args.ocrPipelines.length > 0 ? await runOcrEval(args, prepared, debugRoot, log) : null;
  const summaries: ModelSummary[] = sortSummaries(
    args.models.flatMap((target, index) =>
      args.pipelines.map((pipeline) =>
        summarizeModel(
          target.label,
          (results[index]?.runs ?? []).filter((run) => run.pipeline === pipeline),
          results[index]?.skipped ?? null,
          pipeline,
        ),
      ),
    ),
  );
  const sampleSummaries: ModelSummary[] = samples.flatMap((sample) =>
    sortSummaries(
      args.models.flatMap((target, index) =>
        args.pipelines.map((pipeline) =>
          summarizeModel(
            target.label,
            (results[index]?.runs ?? []).filter(
              (run) => run.pipeline === pipeline && run.sampleId === sample.id,
            ),
            results[index]?.skipped ?? null,
            pipeline,
            sample.id,
          ),
        ),
      ),
    ),
  );
  const aiRuns = results.flatMap((result) => result.runs);
  const runs = [...aiRuns, ...(ocr?.runs ?? [])];
  const totalDays = Math.max(
    0,
    ...prepared.flatMap(({ sample }) =>
      Object.values(sample.truth.people).map((days) => Object.keys(days).length),
    ),
  );

  if (aiRuns.length > 0) {
    console.log(
      `\n## Models (sorted by e2e accuracy, then paid cost; model failures score 0, infra failures excluded; prices as of ${MODEL_PRICES_AS_OF})\n`,
    );
    console.log(formatSummaryTable(summaries));
    console.log('\n## Per sample\n');
    console.log(formatSampleTable(sampleSummaries));
  }

  if (ocr) {
    console.log(
      `\n## AI-free OCR pipelines (Spec §20; OCR $0, AI fallback at paid prices as of ${MODEL_PRICES_AS_OF})\n`,
    );
    console.log(formatOcrTable([...ocr.summaries, ...ocr.sampleSummaries]));

    for (const [label, reason] of Object.entries(ocr.skipped)) {
      console.log(`ocr-then-ai ${label} skipped: ${reason}`);
    }
  }

  console.log('\n## Correct days per person (one value per fully successful run)\n');
  console.log(formatPersonTable([...summaries, ...ocrPersonSummaries(ocr?.runs ?? [])], people, totalDays));
  console.log('\n## Wrong / 추측 / null cells (date: expected→got)\n');
  console.log(formatCellErrors(runs) || '(none)');

  const failedRuns = runs.filter((run) => run.status === VisionEvalStatus.FAILED);

  if (failedRuns.length > 0) {
    console.log('\n## Failed runs (model = scored 0 in e2e, infra = excluded)\n');
    console.log(
      failedRuns
        .map(
          (run) =>
            `[${run.pipeline} ${run.model} #${run.repeat}] ${run.sampleId}: (${run.failureKind}) ${run.error}`,
        )
        .join('\n'),
    );
  }

  const resultPath = path.join(resultsDir, `${runId}.json`);

  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        args,
        pricesAsOf: MODEL_PRICES_AS_OF,
        prices: MODEL_PRICES,
        samples: samples.map((sample) => sample.id),
        summaries,
        sampleSummaries,
        ocr: ocr
          ? { summaries: ocr.summaries, sampleSummaries: ocr.sampleSummaries, skipped: ocr.skipped }
          : null,
        runs,
      },
      null,
      1,
    ),
  );
  console.log(`\nresults: ${resultPath}`);
  console.log(`debug images: ${debugRoot}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
