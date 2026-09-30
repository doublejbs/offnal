import { describe, expect, it } from 'vitest';

import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { normalizeExtraction } from '@/domain/ScheduleValidator';
import { type ExtractedCell } from '@/domain/types/ExtractedCell';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { VisionPipelineMode } from '@/domain/enums/VisionPipelineMode';
import { parseEvalArgs, resolveDebugDir, resolveResultsDir } from '@/server/vision/eval/EvalArgs';
import { findCandidateRowId, scorePerson, scoreTable } from '@/server/vision/eval/EvalScoring';
import { type EvalTruth, evalTruthSchema } from '@/server/vision/eval/EvalTruth';
import { estimateCostUsd } from '@/server/vision/eval/ModelPrices';

/** Tiny synthetic truth: only the first four days of one fictional person are scored. */
const TRUTH: EvalTruth = evalTruthSchema.parse({
  yearMonth: '2026-02',
  allNames: ['가상하나', '가상두울'],
  definitions: {
    D: { startTime: '07:00', endTime: '16:00', endsNextDay: false },
    N: { startTime: '22:00', endTime: '07:00', endsNextDay: true },
  },
  undefinedCodesInTable: ['W'],
  people: {
    가상하나: { '2026-02-01': 'D', '2026-02-02': 'N', '2026-02-03': 'OFF', '2026-02-04': 'W' },
  },
});

const DEFINITIONS: ShiftDefinition[] = [
  { code: 'D', label: 'D', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
  { code: 'N', label: 'N', startTime: '22:00', endTime: '06:00', endsNextDay: true, isOff: false },
  { code: 'OFF', label: 'OFF', startTime: null, endTime: null, endsNextDay: null, isOff: true },
];

const cell = (day: number, code: string | null, ambiguous = false): ExtractedCell => ({
  day,
  rawText: code,
  code,
  ambiguous,
});

const buildSchedule = (cells: ExtractedCell[]) =>
  normalizeExtraction(
    { yearMonth: TRUTH.yearMonth, rowId: 'r1', displayName: '가상하나', definitions: DEFINITIONS, cells },
    TRUTH.yearMonth,
  );

describe('vision eval scoring', () => {
  it('scores pass 1: month, name recall with spacing differences and legend times', () => {
    const score = scoreTable(TRUTH, {
      yearMonth: '2026-02',
      candidates: [{ rowId: 'r1', name: '가상 하나' }],
      definitions: DEFINITIONS,
      dayHeaders: [],
    });

    expect(score).toMatchObject({
      yearMonthMatch: true,
      namesFound: 1,
      namesTotal: 2,
      missingNames: ['가상두울'],
      definitionsCorrect: 1,
      definitionsTotal: 2,
    });
    expect(score.definitions).toEqual([
      { code: 'D', found: true, timesMatch: true },
      { code: 'N', found: true, timesMatch: false },
    ]);
    expect(scoreTable(TRUTH, null)).toMatchObject({ yearMonthMatch: false, namesFound: 0 });
    expect(findCandidateRowId([{ rowId: 'r7', name: ' 가상두울' }], '가상두울')).toBe('r7');
  });

  it('separates correct, wrong and null cells and checks the undefined code', () => {
    const score = scorePerson(
      TRUTH,
      '가상하나',
      'r1',
      buildSchedule([cell(1, 'D', true), cell(2, 'E'), cell(3, null), cell(4, 'W')]),
    );

    expect(score).toMatchObject({
      correctDays: 2,
      totalDays: 4,
      fullMonthMatch: false,
      wrongCells: [{ date: '2026-02-02', expected: 'N', got: 'E' }],
      nullDates: ['2026-02-03'],
      // Day 1 is correct but ambiguous, day 4 is W flagged as undefined: both still need review.
      flaggedCorrectDays: 2,
      undefinedCodeCells: [{ date: '2026-02-04', expected: 'W', got: 'W', kept: true, flagged: true }],
      definitionsCorrect: 1,
    });
  });

  it('counts a guessed undefined code as wrong and a full match as a full month', () => {
    const guessed = scorePerson(
      TRUTH,
      '가상하나',
      'r1',
      buildSchedule([cell(1, 'D'), cell(2, 'N'), cell(3, 'OFF'), cell(4, 'D')]),
    );

    expect(guessed.undefinedCodeCells).toEqual([
      { date: '2026-02-04', expected: 'W', got: 'D', kept: false, flagged: false },
    ]);
    expect(guessed.wrongCells).toEqual([{ date: '2026-02-04', expected: 'W', got: 'D' }]);

    const full = scorePerson(
      TRUTH,
      '가상하나',
      'r1',
      buildSchedule([cell(1, 'd'), cell(2, 'N'), cell(3, 'OFF'), cell(4, 'W')]),
    );

    expect(full).toMatchObject({ correctDays: 4, fullMonthMatch: true, wrongCells: [], nullDates: [] });
  });

  it('treats a missing name as every day wrong', () => {
    const score = scorePerson(TRUTH, '가상하나', null, null);

    expect(score).toMatchObject({ rowId: null, correctDays: 0, nullDates: [] });
    expect(score.wrongCells).toHaveLength(4);
    expect(score.wrongCells[0]).toEqual({ date: '2026-02-01', expected: 'D', got: '(none)' });
  });

  it('estimates paid cost with thinking billed as output', () => {
    expect(
      estimateCostUsd('gemini-3.7-flash', {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        thinkingTokens: 100_000,
      }),
    ).toBeCloseTo(0.75 + 0.2 * 3.75);
    expect(
      estimateCostUsd('unknown-model', { inputTokens: 1, outputTokens: 1, thinkingTokens: null }),
    ).toBeNull();
  });

  it('parses eval arguments including anthropic targets and a pnpm separator', () => {
    expect(
      parseEvalArgs([
        '--',
        '--dir',
        'x',
        '--models',
        'gemini-3.7-flash, anthropic:claude-opus-5-5',
        '--repeat',
        '2',
      ]),
    ).toEqual({
      dir: 'x',
      models: [
        { label: 'gemini-3.7-flash', provider: VisionProviderType.GEMINI, model: 'gemini-3.7-flash' },
        {
          label: 'anthropic:claude-opus-5-5',
          provider: VisionProviderType.ANTHROPIC,
          model: 'claude-opus-5-5',
        },
      ],
      people: null,
      repeat: 2,
      pipelines: [VisionPipelineMode.WARP_STRIP],
    });
    expect(() => parseEvalArgs(['--models', 'a', '--repeat', '0'])).toThrow(/--repeat/);
    expect(() => parseEvalArgs([])).toThrow(/--models/);
  });

  it('accepts null truth cells: null is correct there, a code is listed as a guess', () => {
    const truth = evalTruthSchema.parse({
      ...TRUTH,
      people: { 가상하나: { '2026-02-01': 'D', '2026-02-02': null, '2026-02-03': null } },
    });
    const schedule = normalizeExtraction(
      {
        yearMonth: truth.yearMonth,
        rowId: 'r1',
        displayName: '가상하나',
        definitions: DEFINITIONS,
        cells: [cell(1, 'D'), { day: 2, rawText: '-', code: null, ambiguous: false }, cell(3, 'OFF')],
      },
      truth.yearMonth,
    );
    const score = scorePerson(truth, '가상하나', 'r1', schedule);

    expect(score).toMatchObject({
      correctDays: 2,
      totalDays: 3,
      fullMonthMatch: false,
      wrongCells: [],
      guessedCells: [{ date: '2026-02-03', got: 'OFF' }],
      nullDates: [],
    });
    expect(scorePerson(truth, '가상하나', null, null).wrongCells).toEqual([
      { date: '2026-02-01', expected: 'D', got: '(none)' },
      { date: '2026-02-02', expected: null, got: '(none)' },
      { date: '2026-02-03', expected: null, got: '(none)' },
    ]);
  });

  it('only writes results under .data/', () => {
    expect(resolveResultsDir('.data/eval', '/repo')).toBe('/repo/.data/eval/results');
    expect(() => resolveResultsDir('eval', '/repo')).toThrow(/\.data\//);
    expect(() => resolveResultsDir('../elsewhere/.data', '/repo')).toThrow(/\.data\//);
    expect(() => resolveResultsDir('/tmp/eval', '/repo')).toThrow(/\.data\//);
    expect(resolveDebugDir('.data/eval', '/repo')).toBe('/repo/.data/eval/debug');
    expect(() => resolveDebugDir('eval', '/repo')).toThrow(/\.data\//);
  });

  it('parses --pipeline lists and defaults to warp-strip', () => {
    expect(parseEvalArgs(['--models', 'gemini-x']).pipelines).toEqual([VisionPipelineMode.WARP_STRIP]);
    expect(
      parseEvalArgs(['--', '--models', 'gemini-x', '--pipeline', 'baseline,warp,warp-strip,warp']).pipelines,
    ).toEqual([VisionPipelineMode.BASELINE, VisionPipelineMode.WARP, VisionPipelineMode.WARP_STRIP]);
    expect(() => parseEvalArgs(['--models', 'gemini-x', '--pipeline', 'strip'])).toThrow(/--pipeline/);
  });
});
