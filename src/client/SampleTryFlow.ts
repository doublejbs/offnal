import { applyCodeToDate } from '@/client/DraftEditing';
import { buildRecognizedEntries, findSamplePerson, SAMPLE_DEFAULT_ROW_ID } from '@/client/SampleTryData';
import { isEntryUnconfirmed } from '@/client/ShiftStyle';
import { SampleTryStep } from '@/domain/enums/SampleTryStep';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

/**
 * Client-only state of the sample trial (Spec §26.3): read → choose a name → review & fix → done.
 * Pure transitions; the hook adds browser history and events.
 */
export type SampleTryState = {
  step: SampleTryStep;
  selectedRowId: string;
  /** Whose month `entries` holds (fixes are kept while the same person stays chosen). */
  entriesRowId: string;
  entries: ShiftEntry[];
  selectedDate: string | null;
};

export const SAMPLE_TRY_STEPS: SampleTryStep[] = [
  SampleTryStep.READ,
  SampleTryStep.CHOOSE,
  SampleTryStep.REVIEW,
  SampleTryStep.DONE,
];

export const getStepNumber = (step: SampleTryStep): number => SAMPLE_TRY_STEPS.indexOf(step) + 1;

export const createInitialSampleTryState = (): SampleTryState => ({
  step: SampleTryStep.READ,
  selectedRowId: SAMPLE_DEFAULT_ROW_ID,
  entriesRowId: SAMPLE_DEFAULT_ROW_ID,
  entries: buildRecognizedEntries(findSamplePerson(SAMPLE_DEFAULT_ROW_ID)),
  selectedDate: null,
});

export const listReviewDates = (entries: ShiftEntry[]): string[] =>
  entries.filter(isEntryUnconfirmed).map((entry) => entry.date);

export const canFinishReview = (state: SampleTryState): boolean =>
  listReviewDates(state.entries).length === 0;

/** Entering the review with another person starts from their recognized month. */
const enterReview = (state: SampleTryState): SampleTryState => {
  if (state.entriesRowId === state.selectedRowId) {
    return { ...state, step: SampleTryStep.REVIEW };
  }

  return {
    ...state,
    step: SampleTryStep.REVIEW,
    entriesRowId: state.selectedRowId,
    entries: buildRecognizedEntries(findSamplePerson(state.selectedRowId)),
    selectedDate: null,
  };
};

/** Next step; the review cannot be finished while a date still needs checking. */
export const goNext = (state: SampleTryState): SampleTryState => {
  if (state.step === SampleTryStep.READ) {
    return { ...state, step: SampleTryStep.CHOOSE };
  }

  if (state.step === SampleTryStep.CHOOSE) {
    return enterReview(state);
  }

  if (state.step === SampleTryStep.REVIEW && canFinishReview(state)) {
    return { ...state, step: SampleTryStep.DONE, selectedDate: null };
  }

  return state;
};

/** Previous step (the first step has none: the page's back link leaves the trial). */
export const goBack = (state: SampleTryState): SampleTryState => {
  const index = SAMPLE_TRY_STEPS.indexOf(state.step);
  const previous = SAMPLE_TRY_STEPS[index - 1];

  return previous ? { ...state, step: previous } : state;
};

/**
 * Browser back/forward to a recorded step: going forward again never skips the rules of `goNext`
 * (e.g. DONE with an unfixed date lands on REVIEW).
 */
export const restoreStep = (state: SampleTryState, step: SampleTryStep): SampleTryState => {
  let result: SampleTryState = { ...state, step: SampleTryStep.READ };

  while (getStepNumber(result.step) < getStepNumber(step)) {
    const next = goNext(result);

    if (next.step === result.step) {
      break;
    }

    result = next;
  }

  return result;
};

export const selectPerson = (state: SampleTryState, rowId: string): SampleTryState => ({
  ...state,
  selectedRowId: findSamplePerson(rowId).rowId,
});

export const selectDate = (state: SampleTryState, date: string): SampleTryState => ({
  ...state,
  selectedDate: date,
});

/** Picking a code fixes and confirms the selected date (same rule as the real editor). */
export const selectCode = (state: SampleTryState, code: string): SampleTryState => {
  if (!state.selectedDate) {
    return state;
  }

  return { ...state, entries: applyCodeToDate(state.entries, state.selectedDate, code) };
};
