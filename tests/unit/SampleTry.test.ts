import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SAMPLE_PREVIEW_CODES, SAMPLE_DEFINITIONS } from '@/client/SamplePreviewData';
import {
  buildRecognizedEntries,
  getSuggestedCode,
  SAMPLE_DEFAULT_ROW_ID,
  SAMPLE_ROSTER,
  SAMPLE_TRY_IMAGE_PATH,
  SAMPLE_TRY_YEAR_MONTH,
} from '@/client/SampleTryData';
import {
  canFinishReview,
  createInitialSampleTryState,
  goBack,
  goNext,
  listReviewDates,
  restoreStep,
  selectCode,
  selectDate,
  selectPerson,
} from '@/client/SampleTryFlow';
import { SampleTryStep } from '@/domain/enums/SampleTryStep';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { listDates, toDateString } from '@/domain/YearMonth';

import {
  buildSampleRosterSvg,
  SAMPLE_ROSTER_HEIGHT,
  SAMPLE_ROSTER_WIDTH,
} from '../../scripts/SampleRosterSvg';

/** Sample roster trial (Spec §26.3): fixed fictional data, its generated photo and the client-only steps. */

const E2E_MOCK_NAMES = ['김하루', '이여름', '박지우', '남궁하늘빛나래'];
const DEFINED_CODES = new Set(SAMPLE_DEFINITIONS.map((definition) => definition.code));
const DATES = listDates(SAMPLE_TRY_YEAR_MONTH);

const reviewDateOf = (rowId: string): string => {
  const person = SAMPLE_ROSTER.find((item) => item.rowId === rowId);

  return toDateString(2026, 11, person?.reviewDay ?? 0);
};

describe('sample roster data', () => {
  it('has 5–6 fictional people with a full month of defined codes each', () => {
    expect(SAMPLE_ROSTER.length).toBeGreaterThanOrEqual(5);
    expect(SAMPLE_ROSTER.length).toBeLessThanOrEqual(6);
    expect(new Set(SAMPLE_ROSTER.map((person) => person.rowId)).size).toBe(SAMPLE_ROSTER.length);
    expect(new Set(SAMPLE_ROSTER.map((person) => person.name)).size).toBe(SAMPLE_ROSTER.length);

    for (const person of SAMPLE_ROSTER) {
      expect(E2E_MOCK_NAMES).not.toContain(person.name);
      expect(person.codes).toHaveLength(DATES.length);
      expect(person.codes.every((code) => DEFINED_CODES.has(code))).toBe(true);
      expect(person.reviewDay).toBeGreaterThanOrEqual(1);
      expect(person.reviewDay).toBeLessThanOrEqual(DATES.length);
    }

    const allCodes = new Set(SAMPLE_ROSTER.flatMap((person) => person.codes));

    expect([...allCodes].sort()).toEqual([...DEFINED_CODES].sort());
  });

  it('starts from the entry-screen preview person', () => {
    expect(SAMPLE_ROSTER[0]?.rowId).toBe(SAMPLE_DEFAULT_ROW_ID);
    expect(SAMPLE_ROSTER[0]?.codes).toEqual(SAMPLE_PREVIEW_CODES);
  });

  it('recognizes every day except one deliberately unreadable cell, whose printed code is suggested', () => {
    for (const person of SAMPLE_ROSTER) {
      const entries = buildRecognizedEntries(person);
      const review = entries.filter((entry) => !entry.confirmed);

      expect(entries.map((entry) => entry.date)).toEqual(DATES);
      expect(review).toEqual([
        {
          date: reviewDateOf(person.rowId),
          code: null,
          reviewReasons: [ShiftReviewReason.UNREADABLE],
          confirmed: false,
        },
      ]);
      expect(getSuggestedCode(person)).toBe(person.codes[person.reviewDay - 1]);
      expect(
        entries
          .filter((entry) => entry.confirmed)
          .every((entry) => entry.code === person.codes[Number(entry.date.slice(8)) - 1]),
      ).toBe(true);
    }
  });
});

describe('generated roster photo', () => {
  const svg = buildSampleRosterSvg();

  it('draws exactly the data: every name and every cell, the review cell smudged', () => {
    for (const person of SAMPLE_ROSTER) {
      expect(svg).toContain(`>${person.name}</text>`);

      person.codes.forEach((code, index) => {
        const day = index + 1;
        const match = svg.match(
          new RegExp(`<text data-cell="${person.rowId}-${day}"( data-review="true")?[^>]*>([^<]*)</text>`),
        );

        expect(match?.[2], `${person.name} ${day}일`).toBe(code);
        expect(Boolean(match?.[1]), `${person.name} ${day}일 smudge`).toBe(day === person.reviewDay);
      });
    }

    expect(svg.match(/data-review="true"/g)).toHaveLength(SAMPLE_ROSTER.length);
  });

  it('has no hospital name and stays fictional', () => {
    expect(svg).not.toMatch(/병원|의료원|센터/);
    expect(svg).toContain('가상 이름');
  });

  it('is committed at the generated size (regenerate with pnpm sample:roster after data changes)', () => {
    const png = readFileSync(path.join(process.cwd(), 'public', SAMPLE_TRY_IMAGE_PATH));

    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(SAMPLE_ROSTER_WIDTH);
    expect(png.readUInt32BE(20)).toBe(SAMPLE_ROSTER_HEIGHT);
  });
});

describe('sample trial steps', () => {
  it('walks read → choose → review → done', () => {
    let state = createInitialSampleTryState();

    expect(state.step).toBe(SampleTryStep.READ);
    expect(state.selectedRowId).toBe(SAMPLE_DEFAULT_ROW_ID);

    state = goNext(state);
    expect(state.step).toBe(SampleTryStep.CHOOSE);

    state = goNext(state);
    expect(state.step).toBe(SampleTryStep.REVIEW);
    expect(listReviewDates(state.entries)).toEqual([reviewDateOf(SAMPLE_DEFAULT_ROW_ID)]);

    // The review cannot be finished while a date still needs checking.
    expect(canFinishReview(state)).toBe(false);
    expect(goNext(state).step).toBe(SampleTryStep.REVIEW);

    state = selectDate(state, reviewDateOf(SAMPLE_DEFAULT_ROW_ID));
    state = selectCode(state, 'E');
    expect(canFinishReview(state)).toBe(true);
    expect(state.entries.find((entry) => entry.date === reviewDateOf(SAMPLE_DEFAULT_ROW_ID))).toEqual({
      date: reviewDateOf(SAMPLE_DEFAULT_ROW_ID),
      code: 'E',
      reviewReasons: [],
      confirmed: true,
    });

    state = goNext(state);
    expect(state.step).toBe(SampleTryStep.DONE);
    expect(goNext(state).step).toBe(SampleTryStep.DONE);
  });

  it('goes back one step at a time and keeps fixes for the same person', () => {
    let state = goNext(goNext(createInitialSampleTryState()));

    state = selectCode(selectDate(state, reviewDateOf('s1')), 'E');
    state = goNext(state);
    expect(state.step).toBe(SampleTryStep.DONE);

    state = goBack(state);
    expect(state.step).toBe(SampleTryStep.REVIEW);
    expect(canFinishReview(state)).toBe(true);

    state = goBack(state);
    expect(state.step).toBe(SampleTryStep.CHOOSE);
    state = goNext(state);
    expect(canFinishReview(state)).toBe(true);

    state = goBack(goBack(state));
    expect(state.step).toBe(SampleTryStep.READ);
    expect(goBack(state).step).toBe(SampleTryStep.READ);
  });

  it('starts over from the recognized month when another person is chosen', () => {
    let state = goNext(goNext(createInitialSampleTryState()));

    state = selectCode(selectDate(state, reviewDateOf('s1')), 'E');
    state = selectPerson(goBack(state), 's3');
    state = goNext(state);

    expect(state.entriesRowId).toBe('s3');
    expect(state.selectedDate).toBeNull();
    expect(listReviewDates(state.entries)).toEqual([reviewDateOf('s3')]);
  });

  it('ignores unknown people and codes without a selected date', () => {
    const state = createInitialSampleTryState();

    expect(selectPerson(state, 'nobody').selectedRowId).toBe(SAMPLE_DEFAULT_ROW_ID);
    expect(selectCode(state, 'D')).toBe(state);
  });

  it('restores a recorded step without skipping the review rule', () => {
    const initial = createInitialSampleTryState();
    const reviewing = restoreStep(initial, SampleTryStep.DONE);

    expect(reviewing.step).toBe(SampleTryStep.REVIEW);
    expect(restoreStep(initial, SampleTryStep.CHOOSE).step).toBe(SampleTryStep.CHOOSE);

    const fixed = selectCode(selectDate(reviewing, reviewDateOf('s1')), 'E');

    expect(restoreStep(fixed, SampleTryStep.DONE).step).toBe(SampleTryStep.DONE);
    expect(restoreStep(fixed, SampleTryStep.READ).step).toBe(SampleTryStep.READ);
  });
});
