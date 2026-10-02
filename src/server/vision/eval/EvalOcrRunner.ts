import { OcrEvalPipeline } from '@/domain/enums/OcrEvalPipeline';
import { OcrFallbackReason } from '@/domain/enums/OcrFallbackReason';
import { VisionEvalFailureKind } from '@/domain/enums/VisionEvalFailureKind';
import { VisionEvalPersonOutcome } from '@/domain/enums/VisionEvalPersonOutcome';
import { VisionEvalStatus } from '@/domain/enums/VisionEvalStatus';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type TableRecognition } from '@/domain/types/TableRecognition';
import { callWithRetry } from '@/server/vision/eval/EvalCallRetry';
import { renderOcrGrid, renderOcrQuad, renderOcrRow } from '@/server/vision/eval/EvalOcrDebug';
import { buildFailedPersonRun, runPerson } from '@/server/vision/eval/EvalPersonRunner';
import { detectNeighbourRead, scorePerson, scoreTable } from '@/server/vision/eval/EvalScoring';
import { type EvalSample } from '@/server/vision/eval/EvalTruth';
import {
  type CallRecord,
  type EvalCallContext,
  type EvalDebugSink,
  type EvalRun,
  type OcrPersonRecord,
  type PersonRun,
} from '@/server/vision/eval/EvalTypes';
import {
  buildOcrExtraction,
  countUnresolved,
  findOcrRow,
  toOcrRowId,
  UNRESOLVED_FALLBACK_THRESHOLD,
} from '@/server/vision/ocr/OcrPersonExtraction';
import { type OcrProvider } from '@/server/vision/ocr/OcrProvider';
import { readOcrTable } from '@/server/vision/ocr/OcrTableReader';
import { type OcrRow, type OcrTable, type OcrTableResult } from '@/server/vision/ocr/OcrTableTypes';
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

type OcrPerson = { run: PersonRun; row: OcrRow | null; fallback: OcrFallbackReason | null };

/** Scores one truth person from the OCR table alone (null schedule = all days wrong, like a missed name). */
const scoreOcrPerson = (sample: EvalSample, name: string, result: OcrTableResult): OcrPerson => {
  const { truth } = sample;
  const base = { ocrLatencyMs: result.latencyMs, aiPass1: null };

  if (!result.ok) {
    const ocr: OcrPersonRecord = {
      ...base,
      nameFound: false,
      unresolvedCells: null,
      finishedByOcr: false,
      fallback: OcrFallbackReason.TABLE_FAILED,
      tapRowCorrectDays: null,
      tapRowUnresolved: null,
    };

    return {
      run: { ...buildFailedPersonRun(truth, name, VisionEvalPersonOutcome.SCORED), ocr },
      row: null,
      fallback: OcrFallbackReason.TABLE_FAILED,
    };
  }

  const { table } = result;
  const toSchedule = (target: OcrRow) =>
    normalizeExtraction(buildOcrExtraction(table, target, truth.yearMonth), truth.yearMonth);
  // "Tap my row" (metric only): truth names are listed top to bottom, so the index is the row.
  const tapRow =
    table.rows.length === truth.allNames.length ? table.rows[truth.allNames.indexOf(name)] : undefined;
  const tap = tapRow
    ? {
        correct: scorePerson(truth, name, toOcrRowId(tapRow), toSchedule(tapRow)).correctDays,
        unresolved: countUnresolved(tapRow, truth.yearMonth),
      }
    : null;
  const row = findOcrRow(table, name);
  const unresolvedCells = row ? countUnresolved(row, truth.yearMonth) : null;
  const fallback =
    row === null
      ? OcrFallbackReason.NAME_NOT_FOUND
      : unresolvedCells! >= UNRESOLVED_FALLBACK_THRESHOLD
        ? OcrFallbackReason.UNRESOLVED_CELLS
        : null;
  const ocr: OcrPersonRecord = {
    ...base,
    nameFound: row !== null,
    unresolvedCells,
    finishedByOcr: row !== null && unresolvedCells === 0,
    fallback: null,
    tapRowCorrectDays: tap?.correct ?? null,
    tapRowUnresolved: tap?.unresolved ?? null,
  };

  if (!row) {
    return {
      run: { ...buildFailedPersonRun(truth, name, VisionEvalPersonOutcome.SCORED), ocr },
      row,
      fallback,
    };
  }

  const schedule = toSchedule(row);
  const neighbours = [table.rows[row.index - 1]?.name ?? null, table.rows[row.index + 1]?.name ?? null];

  return {
    run: {
      score: scorePerson(truth, name, toOcrRowId(row), schedule),
      outcome: VisionEvalPersonOutcome.SCORED,
      call: null,
      calls: [],
      route: null,
      fallback: null,
      identityVerified: true,
      neighbourRead: detectNeighbourRead(truth, name, neighbours, schedule),
      ocr,
    },
    row,
    fallback,
  };
};

type OcrRunInput = {
  sample: EvalSample;
  people: string[];
  repeat: number;
  result: OcrTableResult;
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
    const person = scoreOcrPerson(input.sample, name, input.result);
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
 * table could not be read, the name was not found, or ≥ UNRESOLVED_FALLBACK_THRESHOLD cells are
 * unresolved. Pass 1 runs lazily, once per photo, only when someone needs AI.
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
    const person = scoreOcrPerson(sample, name, input.result);

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
