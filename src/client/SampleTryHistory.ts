import { SampleTryStep } from '@/domain/enums/SampleTryStep';

/**
 * Browser history entries of the sample trial (Spec §26.3-B). Each mount of /try has its own id: entries left
 * by an earlier mount (before a reload, or before leaving with "내 근무표로 만들기" and coming back) belong to
 * a visit that no longer exists, so they are skipped instead of restoring their step.
 */
const STEP_KEY = 'offnalSampleTryStep';
const MOUNT_KEY = 'offnalSampleTryMount';

const STEP_VALUES = new Set<string>(Object.values(SampleTryStep));

const asRecord = (state: unknown): Record<string, unknown> =>
  typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};

/** The entry's step when it belongs to this mount; null for an entry of another mount (or none). */
export const readTrialHistoryStep = (state: unknown, mountId: string): SampleTryStep | null => {
  const record = asRecord(state);
  const step = record[STEP_KEY];

  if (record[MOUNT_KEY] !== mountId || typeof step !== 'string' || !STEP_VALUES.has(step)) {
    return null;
  }

  return step as SampleTryStep;
};

/** History state for a trial entry; keeps the keys the router stored next to ours. */
export const buildTrialHistoryState = (
  current: unknown,
  mountId: string,
  step: SampleTryStep,
): Record<string, unknown> => ({ ...asRecord(current), [MOUNT_KEY]: mountId, [STEP_KEY]: step });

/** A fresh state for a pushed entry: only our keys (the router adds its own). */
export const buildPushedTrialHistoryState = (
  mountId: string,
  step: SampleTryStep,
): Record<string, unknown> => ({
  [MOUNT_KEY]: mountId,
  [STEP_KEY]: step,
});

export const createTrialMountId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
