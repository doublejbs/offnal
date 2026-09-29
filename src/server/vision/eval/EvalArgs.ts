import { parseArgs } from 'node:util';

import { VisionProviderType } from '@/domain/enums/VisionProviderType';

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

/** Parses `--dir --models --people --repeat`. A bare `--` (from `pnpm x -- …`) is ignored. */
export const parseEvalArgs = (argv: string[]): EvalArgs => {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    options: {
      dir: { type: 'string', default: '.data/eval' },
      models: { type: 'string' },
      people: { type: 'string' },
      repeat: { type: 'string', default: '1' },
    },
    strict: true,
  });
  const models = splitList(values.models).map(parseModelTarget);
  const people = splitList(values.people);
  const repeat = Number(values.repeat);

  if (models.length === 0) {
    throw new Error('--models is required (comma-separated model ids, anthropic:<model> for Claude)');
  }

  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error('--repeat must be a positive integer');
  }

  return { dir: values.dir, models, people: people.length > 0 ? people : null, repeat };
};
