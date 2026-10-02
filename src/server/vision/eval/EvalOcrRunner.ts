import { OcrEvalPipeline } from '@/domain/enums/OcrEvalPipeline';
import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { callWithRetry } from '@/server/vision/eval/EvalCallRetry';
import { renderOcrGrid, renderOcrQuad, renderOcrRow } from '@/server/vision/eval/EvalOcrDebug';
import { scoreOcrPerson } from '@/server/vision/eval/EvalOcrPersonScore';
import { buildFailedPersonRun, runPerson } from '@/server/vision/eval/EvalPersonRunner';
import { scoreTable } from '@/server/vision/eval/EvalScoring';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import {
  type CallRecord,
  type EvalCallContext,
  type EvalDebugSink,
  type EvalRun,
  type PersonRun,
} from '@/server/vision/eval/EvalTypes';
import { toOcrRowId } from '@/server/vision/ocr/OcrPersonExtraction';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { readOcrTable } from '@/server/vision/ocr/OcrTableReader';
import { type OcrTable, type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';
import { type RawImage } from '@/server/vision/VisionGeometry';
import { preparePipelineImage, type PreparedPipelineImage } from '@/server/vision/VisionPipeline';
import { type VisionImage, type VisionProvider } from '@/server/vision/VisionProvider';

/** Model label of the AI-free runs (no model is called). */
export const OCR_MODEL_LABEL = 'tesseract.js';

/** OCR table as a pass-1 recognition, so the usual table score (month, names, legend) applies. */
const toTableRecognition = (table: OcrTable): TableRecognition => ({
  yearMonth: table.yearMonth,
  candidates: table.rows.flatMap((row) => (row.name ? [{ rowId: toOcrRowId(row), name: row.name }] : [])),
  definitions: table.definitions,
  dayHeaders: [],
});

/** Reads the photo once without AI and saves the quad/grid/row debug images. */
export const readSampleWithOcr = async (
  ocr: OcrProvider,
  source: RawImage,
  debug?: EvalDebugSink,
): Promise<OcrTableResult> => {
  const result = await readOcrTable(source, ocr);

  if (debug && result.geometry.quad) {
    await debug('ocr-quad.jpg', await renderOcrQuad(source, result.geometry.quad));
  }

  const grid = debug ? await renderOcrGrid(result.geometry) : null;

  if (debug && grid) {
    await debug('ocr-grid.jpg', grid);
  }

  return result;
};

type OcrRunInput = {
  sample: EvalSample;
  people: string[];
  repeat: number;
  result: OcrTableResult;
  /** Unresolved cells that hand a person to AI in `ocr-then-ai`. */
  fallbackThreshold: number;
  debug?: EvalDebugSink;
};

/** First failure of the run: the shared AI pass 1, else a person's failed AI call (null = OK). */
const findFailure = (people: PersonRun[], pass1: CallRecord | null) => {
  if (pass1 && !pass1.ok) {
    return { error: `pass1: ${pass1.error}`, kind: pass1.failureKind ?? VisionEvalFailureKind.INFRA };
  }

  const failed = people.find((person) => person.call !== null && !person.call.ok);

  return failed?.call
    ? {
        error: `pass2 ${failed.score.name}: ${failed.call.step ?? 'extract'} ${failed.call.error}`,
        kind: failed.call.failureKind ?? VisionEvalFailureKind.INFRA,
      }
    : null;
};

const buildRun = (
  input: OcrRunInput,
  model: string,
  pipeline: OcrEvalPipeline,
  people: PersonRun[],
  pass1: CallRecord | null = null,
): EvalRun => {
  const failure = findFailure(people, pass1);

  return {
    model,
    pipeline,
    sampleId: input.sample.id,
    repeat: input.repeat,
    status: failure ? VisionEvalStatus.FAILED : VisionEvalStatus.OK,
    error: failure?.error ?? null,
    failureKind: failure?.kind ?? null,
    tableCall: pass1,
    table: scoreTable(input.sample.truth, input.result.ok ? toTableRecognition(input.result.table) : null),
    grid: null,
    warpApplied: input.result.geometry.warped !== null,
    people,
  };
};

/** `--pipeline ocr`: every person from OCR only; unresolved cells stay 확인 필요 (Spec §20). */
export const runOcrPipeline = async (input: OcrRunInput): Promise<EvalRun> => {
  const people: PersonRun[] = [];

  for (const [index, name] of input.people.entries()) {
    const person = scoreOcrPerson(input.sample, name, input.result, input.fallbackThreshold);
    const image = person.row && input.debug ? await renderOcrRow(input.result.geometry, person.row) : null;

    if (image && input.debug) {
      await input.debug(`ocr-p${index + 1}-cells.jpg`, image);
    }

    people.push(person.run);
  }

  return buildRun(input, OCR_MODEL_LABEL, OcrEvalPipeline.OCR, people);
};

export type OcrThenAiInput = OcrRunInput & {
  context: EvalCallContext;
  provider: VisionProvider;
  /** Provider copy of the photo (as in the AI pipelines). */
  image: VisionImage;
};

type AiSetup = { pass1: CallRecord; table: TableRecognition | null; prepared: PreparedPipelineImage | null };

/**
 * `--pipeline ocr-then-ai`: OCR first; a person goes to the existing warp-strip AI pipeline only when the
 * table could not be read, the name was not found, or ≥ `fallbackThreshold` cells are unresolved. Pass 1 runs lazily, once per photo, only when someone needs AI.
 */
export const runOcrThenAiPipeline = async (input: OcrThenAiInput): Promise<EvalRun> => {
  const { context, provider, sample, repeat, debug } = input;
  // Held in an object: TypeScript does not track assignments made inside the closure.
  const shared: { setup: AiSetup | null } = { setup: null };

  const ensureAi = async (): Promise<AiSetup> => {
    if (shared.setup) {
      return shared.setup;
    }

    const pass1 = await callWithRetry(context, (signal) => provider.recognizeTable(input.image, signal));
    const table = pass1.value?.ok ? pass1.value.value : null;
    const prepared = table
      ? await preparePipelineImage(VisionPipelineMode.WARP_STRIP, input.image, table.grid ?? null)
      : null;

    shared.setup = { pass1: pass1.record, table, prepared };

    return shared.setup;
  };

  const people: PersonRun[] = [];

  for (const [index, name] of input.people.entries()) {
    const person = scoreOcrPerson(sample, name, input.result, input.fallbackThreshold);

    if (person.fallback === null) {
      people.push(person.run);
      continue;
    }

    const ai = await ensureAi();
    const ocr = { ...person.run.ocr!, fallback: person.fallback, aiPass1: ai.pass1 };

    if (!ai.table || !ai.prepared) {
      // Pass 1 answered without a table (no_table/no_names) or with unusable output: the model's miss.
      const outcome =
        ai.pass1.ok || ai.pass1.failureKind === VisionEvalFailureKind.MODEL
          ? VisionEvalPersonOutcome.MODEL_FAILURE
          : VisionEvalPersonOutcome.INFRA_FAILURE;

      people.push({ ...buildFailedPersonRun(sample.truth, name, outcome), ocr });
      continue;
    }

    const run = await runPerson({
      context,
      provider,
      sample,
      repeat,
      debug,
      table: ai.table,
      prepared: ai.prepared,
      name,
      index,
    });

    people.push({ ...run, ocr });
  }

  return buildRun(
    input,
    context.target.label,
    OcrEvalPipeline.OCR_THEN_AI,
    people,
    shared.setup?.pass1 ?? null,
  );
};
