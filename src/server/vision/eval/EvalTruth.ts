import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const truthDefinitionSchema = z.object({
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  endsNextDay: z.boolean().nullable(),
});

export const evalTruthSchema = z.object({
  image: z.string().default('image.jpg'),
  yearMonth: z.string(),
  allNames: z.array(z.string()),
  /** Legend codes with their times (OFF-like codes are not listed). */
  definitions: z.record(z.string(), truthDefinitionSchema),
  /** Codes used in the table but missing from the legend; they must be kept, never guessed. */
  undefinedCodesInTable: z.array(z.string()).default([]),
  /** Scored people: name → { YYYY-MM-DD → code }. */
  people: z.record(z.string(), z.record(z.string(), z.string())),
  notes: z.string().optional(),
});

export type EvalTruth = z.infer<typeof evalTruthSchema>;

export type EvalSample = {
  id: string;
  imagePath: string;
  truth: EvalTruth;
};

/** Each sub-folder of `dir` holding a truth.json is one sample (results/ and others are ignored). */
export const loadEvalSamples = async (dir: string): Promise<EvalSample[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const samples: EvalSample[] = [];

  for (const entry of entries
    .filter((item) => item.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const truthPath = path.join(dir, entry.name, 'truth.json');
    const raw = await readFile(truthPath, 'utf8').catch(() => null);

    if (raw === null) {
      continue;
    }

    const truth = evalTruthSchema.parse(JSON.parse(raw));

    samples.push({ id: entry.name, imagePath: path.join(dir, entry.name, truth.image), truth });
  }

  return samples;
};
