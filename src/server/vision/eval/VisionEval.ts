/**
 * Vision model comparison eval (Spec §13): `pnpm vision:eval -- --dir .data/eval --models a,b --repeat 2`.
 * Runs the real two-pass flow per model × sample, scores it against truth.json and writes
 * `.data/eval/results/<timestamp>.json`. Eval images, truths and results stay out of Git (`.data/`).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GeminiTier } from '@/domain/enums/GeminiTier';
import { VisionEffort } from '@/domain/enums/VisionEffort';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { createAnthropicVisionProvider } from '@/server/vision/AnthropicVisionProvider';
import { type EvalModelTarget, parseEvalArgs, resolveResultsDir } from '@/server/vision/eval/EvalArgs';
import {
  formatCellErrors,
  formatPersonTable,
  formatSummaryTable,
  type ModelSummary,
  sortSummaries,
  summarizeModel,
} from '@/server/vision/eval/EvalReport';
import { type EvalRun, ModelUnavailableError, runSample } from '@/server/vision/eval/EvalRunner';
import { type EvalSample, loadEvalSamples } from '@/server/vision/eval/EvalTruth';
import { MODEL_PRICES, MODEL_PRICES_AS_OF } from '@/server/vision/eval/ModelPrices';
import { createGeminiVisionProvider } from '@/server/vision/GeminiVisionProvider';
import { prepareImageForVision } from '@/server/vision/VisionImagePreparer';
import { type VisionImage, type VisionProvider } from '@/server/vision/VisionProvider';

const PROVIDER_TIMEOUT_MS = 240_000;

const log = (line: string): void => {
  console.error(line);
};

const readEnv = (key: string): string | null => {
  const value = process.env[key]?.trim();

  return value ? value : null;
};

/** Provider for a target, or the reason it is skipped (missing key). Keys are never printed. */
const createProvider = (target: EvalModelTarget): VisionProvider | string => {
  if (target.provider === VisionProviderType.ANTHROPIC) {
    const apiKey = readEnv('ANTHROPIC_API_KEY');

    if (!apiKey) {
      return 'ANTHROPIC_API_KEY is not set';
    }

    const effort = Object.values(VisionEffort).find((value) => value === readEnv('VISION_EFFORT'));

    return createAnthropicVisionProvider({
      apiKey,
      model: target.model,
      effort: effort ?? VisionEffort.MEDIUM,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
  }

  const apiKey = readEnv('GEMINI_API_KEY');

  if (!apiKey) {
    return 'GEMINI_API_KEY is not set';
  }

  return createGeminiVisionProvider({ apiKey, model: target.model, timeoutMs: PROVIDER_TIMEOUT_MS });
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

/** Models run in parallel (separate quotas); calls within one model run sequentially. */
const runModel = async (
  target: EvalModelTarget,
  samples: PreparedSample[],
  repeat: number,
): Promise<ModelResult> => {
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
        runs.push(await runSample({ context, provider, sample, image, people, repeat: index }));
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

const main = async (): Promise<void> => {
  const args = parseEvalArgs(process.argv.slice(2));
  // Fail before any paid/quota-limited call if results would land outside .data/.
  const resultsDir = resolveResultsDir(args.dir, process.cwd());

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
  const people = [...new Set(prepared.flatMap((sample) => sample.people))];
  const startedAt = new Date();

  log(
    `vision eval: ${samples.length} sample(s), ${people.length} person(s), ${args.models.length} model(s), repeat ${args.repeat}`,
  );

  const results = await Promise.all(args.models.map((target) => runModel(target, prepared, args.repeat)));
  const summaries: ModelSummary[] = sortSummaries(
    args.models.map((target, index) =>
      summarizeModel(target.label, results[index]?.runs ?? [], results[index]?.skipped ?? null),
    ),
  );
  const runs = results.flatMap((result) => result.runs);
  const totalDays = Math.max(
    0,
    ...prepared.flatMap(({ sample }) =>
      Object.values(sample.truth.people).map((days) => Object.keys(days).length),
    ),
  );

  console.log(
    `\n## Models (sorted by e2e accuracy, then paid cost; model failures score 0, infra failures excluded; prices as of ${MODEL_PRICES_AS_OF})\n`,
  );
  console.log(formatSummaryTable(summaries));
  console.log('\n## Correct days per person (one value per fully successful run)\n');
  console.log(formatPersonTable(summaries, people, totalDays));
  console.log('\n## Wrong / 추측 / null cells (date: expected→got)\n');
  console.log(formatCellErrors(runs) || '(none)');

  const failedRuns = runs.filter((run) => run.status === VisionEvalStatus.FAILED);

  if (failedRuns.length > 0) {
    console.log('\n## Failed runs (model = scored 0 in e2e, infra = excluded)\n');
    console.log(
      failedRuns
        .map((run) => `[${run.model} #${run.repeat}] ${run.sampleId}: (${run.failureKind}) ${run.error}`)
        .join('\n'),
    );
  }

  const resultPath = path.join(resultsDir, `${startedAt.toISOString().replace(/[:.]/gu, '-')}.json`);

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
        runs,
      },
      null,
      1,
    ),
  );
  console.log(`\nresults: ${resultPath}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
