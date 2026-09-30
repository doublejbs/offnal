import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { callWithRetry } from '@/server/vision/eval/EvalCallRetry';
import { renderGridOverlay } from '@/server/vision/eval/EvalDebugImages';
import { buildFailedPersonRun, formatSeconds, runPerson } from '@/server/vision/eval/EvalPersonRunner';
import { scoreTable } from '@/server/vision/eval/EvalScoring';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import {
  type EvalCallContext,
  type EvalDebugSink,
  type EvalRun,
  type PersonRun,
} from '@/server/vision/eval/EvalTypes';
import { preparePipelineImage } from '@/server/vision/VisionPipeline';
import { type VisionImage, type VisionProvider } from '@/server/vision/VisionProvider';

export type RunSampleInput = {
  context: EvalCallContext;
  provider: VisionProvider;
  sample: EvalSample;
  image: VisionImage;
  people: string[];
  repeat: number;
  /** Pipelines compared on the same pass-1 result (default: baseline only). */
  pipelines?: VisionPipelineMode[];
  debug?: EvalDebugSink;
};

/** First failed pass-2 call of the run (the person's failing call), or null. */
const findRunFailure = (personRuns: PersonRun[]): { error: string; kind: VisionEvalFailureKind } | null => {
  const failed = personRuns.find((person) => person.call !== null && !person.call.ok);

  return failed?.call
    ? {
        error: `pass2 ${failed.score.name}: ${failed.call.step ?? 'extract'} ${failed.call.error}`,
        kind: failed.call.failureKind ?? VisionEvalFailureKind.INFRA,
      }
    : null;
};

/**
 * Same flow as the service: pass 1 once (shared by every compared pipeline), then pass 2 per scored person
 * and pipeline with the matching candidate row and the pass-1 legend, normalized with the true
 * (user-chosen) month. Returns one run per pipeline.
 */
export const runSample = async (input: RunSampleInput): Promise<EvalRun[]> => {
  const { context, provider, sample, image, people, repeat, debug } = input;
  const pipelines = input.pipelines ?? [VisionPipelineMode.BASELINE];
  const { target, log } = context;
  const { truth } = sample;
  const base = { model: target.label, sampleId: sample.id, repeat };
  const pass1 = await callWithRetry(context, (signal) => provider.recognizeTable(image, signal));
  const tableResult = pass1.value;

  if (!tableResult || !tableResult.ok) {
    // A no_table/unreadable/no_names outcome is the model's reading, not an outage.
    const outcomeFailure = tableResult && !tableResult.ok ? tableResult.errorCode : null;
    const failureKind = outcomeFailure
      ? VisionEvalFailureKind.MODEL
      : (pass1.record.failureKind ?? VisionEvalFailureKind.INFRA);
    const error = outcomeFailure ?? pass1.record.error;
    const outcome =
      failureKind === VisionEvalFailureKind.MODEL
        ? VisionEvalPersonOutcome.MODEL_FAILURE
        : VisionEvalPersonOutcome.INFRA_FAILURE;

    log(`[${target.label}] ${sample.id} #${repeat} pass1 FAILED (${failureKind}) ${error}`);

    return pipelines.map((pipeline) => ({
      ...base,
      pipeline,
      status: VisionEvalStatus.FAILED,
      error: `pass1: ${error}`,
      failureKind,
      tableCall: pass1.record,
      table: scoreTable(truth, null),
      grid: null,
      warpApplied: false,
      people: people.map((name) => buildFailedPersonRun(truth, name, outcome)),
    }));
  }

  const table = tableResult.value;
  const grid = table.grid ?? null;
  // One warp per run, shared by the warp pipelines (same pass-1 corners).
  const warped = pipelines.some((pipeline) => pipeline !== VisionPipelineMode.BASELINE)
    ? await preparePipelineImage(VisionPipelineMode.WARP, image, grid)
    : null;

  log(
    `[${target.label}] ${sample.id} #${repeat} pass1 ok ${formatSeconds(pass1.record.latencyMs)} grid ${
      grid ? (warped?.warp ? 'warped' : `unusable (${warped?.fallback})`) : 'null'
    }`,
  );

  if (debug && grid) {
    await debug('grid.jpg', await renderGridOverlay(image, grid, warped?.warp?.quad ?? null));
  }

  if (warped?.warp && debug) {
    await debug('warped.jpg', warped.warp.image);
  }

  const runs: EvalRun[] = [];

  for (const pipeline of pipelines) {
    const prepared =
      pipeline === VisionPipelineMode.BASELINE || !warped
        ? await preparePipelineImage(VisionPipelineMode.BASELINE, image, grid)
        : { ...warped, mode: pipeline };
    const personRuns: PersonRun[] = [];

    for (const [index, name] of people.entries()) {
      personRuns.push(
        await runPerson({ context, provider, sample, repeat, debug, table, prepared, name, index }),
      );
    }

    const failure = findRunFailure(personRuns);

    runs.push({
      ...base,
      pipeline,
      status: failure ? VisionEvalStatus.FAILED : VisionEvalStatus.OK,
      error: failure?.error ?? null,
      failureKind: failure?.kind ?? null,
      tableCall: pass1.record,
      table: scoreTable(truth, table),
      grid,
      warpApplied: prepared.warp !== null,
      people: personRuns,
    });
  }

  return runs;
};
