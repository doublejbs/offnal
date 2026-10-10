import { describe, expect, it } from 'vitest';

import {
  buildPushedTrialHistoryState,
  buildTrialHistoryState,
  createTrialMountId,
  readTrialHistoryStep,
} from '@/client/SampleTryHistory';
import { SampleTryStep } from '@/domain/enums/SampleTryStep';

/** Spec §26.3-B: only this mount's history entries restore a step; earlier visits' entries are skipped. */

describe('sample trial history entries', () => {
  it("restores the step of this mount's entries", () => {
    const state = buildPushedTrialHistoryState('m1', SampleTryStep.REVIEW);

    expect(readTrialHistoryStep(state, 'm1')).toBe(SampleTryStep.REVIEW);
  });

  it('ignores entries of another mount, without a trial step, or with an unknown step', () => {
    expect(readTrialHistoryStep(buildPushedTrialHistoryState('old', SampleTryStep.DONE), 'm1')).toBeNull();
    expect(readTrialHistoryStep({ __NA: true }, 'm1')).toBeNull();
    expect(readTrialHistoryStep(null, 'm1')).toBeNull();
    expect(
      readTrialHistoryStep({ offnalSampleTryMount: 'm1', offnalSampleTryStep: 'paid' }, 'm1'),
    ).toBeNull();
  });

  it("re-labels the current entry for a new mount and keeps the router's keys", () => {
    const stale = { __NA: true, tree: ['x'], ...buildPushedTrialHistoryState('old', SampleTryStep.CHOOSE) };
    const fresh = buildTrialHistoryState(stale, 'm2', SampleTryStep.READ);

    expect(fresh).toMatchObject({ __NA: true, tree: ['x'] });
    expect(readTrialHistoryStep(fresh, 'm2')).toBe(SampleTryStep.READ);
    expect(readTrialHistoryStep(fresh, 'old')).toBeNull();
  });

  it('creates distinct mount ids', () => {
    expect(createTrialMountId()).not.toBe(createTrialMountId());
  });
});
