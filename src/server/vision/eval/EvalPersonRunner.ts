import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionPipelineStep } from '@/domain/enums/VisionPipelineStep';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { callWithRetry } from '@/server/vision/eval/EvalCallRetry';
import { findCandidateRowId, scorePerson } from '@/server/vision/eval/EvalScoring';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import {
  type CallRecord,
  type EvalCallContext,
  type EvalDebugSink,
  type PersonRun,
} from '@/server/vision/eval/EvalTypes';
import { buildRowContext } from '@/server/vision/RowIdentity';
import {
  extractPersonWithPipeline,
  type PipelineCallRunner,
  type PreparedPipelineImage,
} from '@/server/vision/VisionPipeline';
import { type VisionProvider } from '@/server/vision/VisionProvider';

export const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export const toPersonOutcome = (record: CallRecord): VisionEvalPersonOutcome => {
  if (record.ok) {
    return VisionEvalPersonOutcome.SCORED;
  }

  return record.failureKind === VisionEvalFailureKind.MODEL
    ? VisionEvalPersonOutcome.MODEL_FAILURE
    : VisionEvalPersonOutcome.INFRA_FAILURE;
};

/** A person whose pass 2 never ran or failed: every day counts as wrong (or is excluded as infra). */
export const buildFailedPersonRun = (
  truth: EvalSample['truth'],
  name: string,
  outcome: VisionEvalPersonOutcome,
  rowId: string | null = null,
  calls: CallRecord[] = [],
  call: CallRecord | null = null,
): PersonRun => ({
  score: scorePerson(truth, name, rowId, null),
  outcome,
  call,
  calls,
  route: null,
  fallback: null,
  identityVerified: null,
});

export type PersonRunInput = {
  context: EvalCallContext;
  provider: VisionProvider;
  sample: EvalSample;
  repeat: number;
  debug?: EvalDebugSink;
  table: TableRecognition;
  prepared: PreparedPipelineImage;
  name: string;
  index: number;
};

const isExtractStep = (record: CallRecord): boolean =>
  record.step === VisionPipelineStep.EXTRACT || record.step === VisionPipelineStep.EXTRACT_STRIP;

/**
 * Pass 2 of one truth person through the pipeline, every call with retries. Calls rethrow the original
 * provider error (so the pipeline treats timeouts/missing keys exactly like the service). Any failed call
 * — including a locateRow the pipeline recovered from — fails the person per the usual rules (model
 * failure scores 0, infra failure is excluded), so a partial path is never scored as a clean run.
 */
export const runPerson = async (input: PersonRunInput): Promise<PersonRun> => {
  const { context, provider, sample, repeat, debug, table, prepared, name, index } = input;
  const { truth } = sample;
  const label = `[${context.target.label}] ${sample.id} #${repeat} ${prepared.mode} pass2 ${name}`;
  const rowId = findCandidateRowId(table.candidates, name);

  if (rowId === null) {
    // Missing name: the model's miss, scored as all days wrong.
    return buildFailedPersonRun(truth, name, VisionEvalPersonOutcome.SCORED);
  }

  const candidateName = table.candidates.find((candidate) => candidate.rowId === rowId)?.name ?? name;
  const calls: CallRecord[] = [];
  const failures = new Map<unknown, CallRecord>();
  const runCall: PipelineCallRunner = async (step, run) => {
    const result = await callWithRetry(context, run);
    const record = { ...result.record, step };

    calls.push(record);

    if (result.value === null) {
      failures.set(result.error, record);
      throw result.error;
    }

    return result.value;
  };
  const failPerson = (record: CallRecord): PersonRun => {
    context.log(`${label} FAILED (${record.step} ${record.failureKind}) ${record.error}`);

    return buildFailedPersonRun(truth, name, toPersonOutcome(record), rowId, calls, record);
  };

  try {
    const result = await extractPersonWithPipeline(
      provider,
      prepared,
      {
        rowId,
        name: candidateName,
        yearMonth: truth.yearMonth,
        definitions: table.definitions,
        rowContext: buildRowContext(table.candidates, rowId),
      },
      runCall,
    );

    if (result.strip && debug) {
      await debug(`${prepared.mode}-p${index + 1}-strip.jpg`, result.strip);
    }

    const recovered = calls.find((call) => !call.ok);

    if (recovered) {
      return failPerson(recovered);
    }

    const score = scorePerson(truth, name, rowId, normalizeExtraction(result.extraction, truth.yearMonth));
    const latencyMs = calls.reduce((sum, call) => sum + call.latencyMs, 0);

    context.log(
      `${label} ${score.correctDays}/${score.totalDays} via ${result.route}${
        result.fallback ? ` (fallback ${result.fallback})` : ''
      }${result.identityVerified ? '' : ' (row unverified)'} ${formatSeconds(latencyMs)}`,
    );

    return {
      score,
      outcome: VisionEvalPersonOutcome.SCORED,
      call: calls.findLast(isExtractStep) ?? null,
      calls,
      route: result.route,
      fallback: result.fallback,
      identityVerified: result.identityVerified,
    };
  } catch (error: unknown) {
    const record = failures.get(error);

    if (!record) {
      throw error;
    }

    return failPerson(record);
  }
};
