import path from 'node:path';
import { parseArgs } from 'node:util';

import { OcrEvalPipeline } from '@/domain/enums/OcrEvalPipeline';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { UNRESOLVED_FALLBACK_THRESHOLD } from '@/server/vision/ocr/OcrPersonExtraction';

export type EvalModelTarget = {
  /** As given on the command line, e.g. `gemini-3.7-flash` or `anthropic:claude-opus-5-5`. */
  label: string;
  provider: VisionProviderType;
  model: string;
};

export type EvalArgs = {
  dir: string;
  models: EvalModelTarget[];
  /** Subset of truth people to score; null = everyone in truth.json. */
  people: string[] | null;
  repeat: number;
  /** Second-pass pipelines to compare on the same pass-1 result. */
  pipelines: VisionPipelineMode[];
  /** AI-free pipelines (Spec §21); `ocr-then-ai` runs per model, `ocr` once. */
  ocrPipelines: OcrEvalPipeline[];
  /** `ocr-then-ai` hands a person to AI at this many unresolved cells (Spec §21-8; default 3). */
  ocrFallbackThreshold: number;
};

const ANTHROPIC_PREFIX = 'anthropic:';
const GEMINI_PREFIX = 'gemini:';

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/** Bare ids are Gemini models; `anthropic:<model>` selects Claude (`gemini:<model>` is also accepted). */
export const parseModelTarget = (label: string): EvalModelTarget => {
  if (label.startsWith(ANTHROPIC_PREFIX)) {
    return { label, provider: VisionProviderType.ANTHROPIC, model: label.slice(ANTHROPIC_PREFIX.length) };
  }

  if (label.startsWith(GEMINI_PREFIX)) {
    return { label, provider: VisionProviderType.GEMINI, model: label.slice(GEMINI_PREFIX.length) };
  }

  return { label, provider: VisionProviderType.GEMINI, model: label };
};

const ALL_PIPELINES: string[] = [...Object.values(VisionPipelineMode), ...Object.values(OcrEvalPipeline)];

/** AI and OCR pipelines from `--pipeline`; no value = warp-strip (AI) only. */
const parsePipelines = (value: string | undefined) => {
  const items = splitList(value);
  const unknown = items.find((item) => !ALL_PIPELINES.includes(item));

  if (unknown !== undefined) {
    throw new Error(`--pipeline must be a comma-separated list of ${ALL_PIPELINES.join(', ')}`);
  }

  const pipelines = Object.values(VisionPipelineMode).filter((mode) => items.includes(mode));
  const ocrPipelines = Object.values(OcrEvalPipeline).filter((mode) => items.includes(mode));

  return {
    pipelines: items.length > 0 ? pipelines : [VisionPipelineMode.WARP_STRIP],
    ocrPipelines,
  };
};

/**
 * Parses `--dir --models --people --repeat --pipeline --ocr-fallback-threshold`. A bare `--` (from `pnpm x -- …`) is ignored. `--models`
 * may be omitted when only `--pipeline ocr` runs (no AI call).
 */
export const parseEvalArgs = (argv: string[]): EvalArgs => {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    options: {
      dir: { type: 'string', default: '.data/eval' },
      models: { type: 'string' },
      people: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      pipeline: { type: 'string' },
      'ocr-fallback-threshold': { type: 'string', default: String(UNRESOLVED_FALLBACK_THRESHOLD) },
    },
    strict: true,
  });
  const models = splitList(values.models).map(parseModelTarget);
  const people = splitList(values.people);
  const repeat = Number(values.repeat);
  const ocrFallbackThreshold = Number(values['ocr-fallback-threshold']);
  const { pipelines, ocrPipelines } = parsePipelines(values.pipeline);
  const needsModel = pipelines.length > 0 || ocrPipelines.includes(OcrEvalPipeline.OCR_THEN_AI);

  if (models.length === 0 && needsModel) {
    throw new Error('--models is required (comma-separated model ids, anthropic:<model> for Claude)');
  }

  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error('--repeat must be a positive integer');
  }

  if (!Number.isInteger(ocrFallbackThreshold) || ocrFallbackThreshold < 1) {
    throw new Error('--ocr-fallback-threshold must be a positive integer');
  }

  return {
    dir: values.dir,
    models,
    people: people.length > 0 ? people : null,
    repeat,
    pipelines,
    ocrPipelines,
    ocrFallbackThreshold,
  };
};

/** Directory that must contain eval results: they hold names and shifts, and `.data/` is not in Git. */
export const EVAL_DATA_ROOT = '.data';

/** `<dir>/<subdir>`, refused unless it resolves inside `<cwd>/.data/`. */
export const resolveDataSubdir = (dir: string, subdir: string, cwd: string): string => {
  const resolved = path.resolve(cwd, dir, subdir);
  const relative = path.relative(path.resolve(cwd, EVAL_DATA_ROOT), resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Eval output must be written under ${EVAL_DATA_ROOT}/ (not in Git): ${resolved}`);
  }

  return resolved;
};

/** `<dir>/results`, refused unless it resolves inside `<cwd>/.data/`. */
export const resolveResultsDir = (dir: string, cwd: string): string => resolveDataSubdir(dir, 'results', cwd);

/** `<dir>/debug` for warped tables and strips (names visible), refused outside `<cwd>/.data/`. */
export const resolveDebugDir = (dir: string, cwd: string): string => resolveDataSubdir(dir, 'debug', cwd);
