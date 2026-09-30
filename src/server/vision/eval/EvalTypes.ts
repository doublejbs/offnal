import { type VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { type VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { type VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { type VisionPipelineFallback } from '@/domain/enums/VisionPipelineFallback';
import { type VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { type VisionPipelineRoute } from '@/domain/enums/VisionPipelineRoute';
import { type VisionPipelineStep } from '@/domain/enums/VisionPipelineStep';
import { type GridCorners } from '@/domain/types/GridCorners';
import { type EvalModelTarget } from '@/server/vision/eval/EvalArgs';
import { type PersonScore, type TableScore } from '@/server/vision/eval/EvalScoring';
import { type VisionImage, type VisionUsage } from '@/server/vision/VisionProvider';

/** Records of the model comparison eval (Spec §13, §15); written to `.data/eval/results`. */

export type CallRecord = {
  /** Pass-2 pipeline step; absent for pass 1. */
  step?: VisionPipelineStep;
  ok: boolean;
  latencyMs: number;
  retries: number;
  usage: VisionUsage | null;
  costUsd: number | null;
  error: string | null;
  failureKind: VisionEvalFailureKind | null;
};

export type PersonRun = {
  score: PersonScore;
  outcome: VisionEvalPersonOutcome;
  /** Final extract call (null when the name was not found or pass 1 failed). */
  call: CallRecord | null;
  /** Every pass-2 call of this person in order (locate + extract), for tokens, cost and latency. */
  calls: CallRecord[];
  route: VisionPipelineRoute | null;
  fallback: VisionPipelineFallback | null;
  /** The model confirmed the row by reading its name back (null when pass 2 did not run). */
  identityVerified: boolean | null;
};

export type EvalRun = {
  model: string;
  pipeline: VisionPipelineMode;
  sampleId: string;
  repeat: number;
  status: VisionEvalStatus;
  error: string | null;
  /** Kind of the first failure in this run, null when OK. */
  failureKind: VisionEvalFailureKind | null;
  tableCall: CallRecord | null;
  table: TableScore | null;
  /** Pass-1 grid corners (null when not returned). */
  grid: GridCorners | null;
  /** Whether the warped table was usable for this run (always false for baseline). */
  warpApplied: boolean;
  people: PersonRun[];
};

type Logger = (line: string) => void;

/** Per-model context shared by all its calls (sequential within one model). */
export type EvalCallContext = {
  target: EvalModelTarget;
  log: Logger;
  /** Calls made so far for this model; "model unavailable" is only decided on the first one. */
  state: { calls: number };
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<unknown>;
};

/** Receives debug images (warped table, strips) of a run; the eval writes them under `.data/`. */
export type EvalDebugSink = (fileName: string, image: VisionImage) => Promise<void>;
