import { describe, expect, it, vi } from 'vitest';

import { createAutosaveTimer, shouldSaveOnLeave } from '@/client/AutosaveTimer';

const createFakeClock = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    clock: {
      setTimeout: (callback: () => void, ms: number) => {
        const id = nextId;

        nextId += 1;
        timers.set(id, { at: now + ms, callback });

        return id;
      },
      clearTimeout: (id: number | undefined) => {
        if (id !== undefined) {
          timers.delete(id);
        }
      },
    },
    advance: (ms: number) => {
      now += ms;

      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
};

describe('createAutosaveTimer', () => {
  it('flushes once, delayMs after the last schedule', () => {
    const { clock, advance } = createFakeClock();
    const flush = vi.fn();
    const timer = createAutosaveTimer(flush, 600, clock);

    timer.schedule();
    advance(400);
    timer.schedule();
    advance(400);
    expect(flush).not.toHaveBeenCalled();
    advance(200);
    expect(flush).toHaveBeenCalledOnce();
  });

  it('cancel stops a scheduled flush', () => {
    const { clock, advance } = createFakeClock();
    const flush = vi.fn();
    const timer = createAutosaveTimer(flush, 600, clock);

    timer.schedule();
    timer.cancel();
    advance(1000);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe('shouldSaveOnLeave', () => {
  it('saves only unsaved edits the queue still allows', () => {
    expect(shouldSaveOnLeave({ isDirty: () => true })).toBe(true);
    expect(shouldSaveOnLeave({ isDirty: () => false })).toBe(false);
    expect(shouldSaveOnLeave({ isDirty: () => true, canSaveOnLeave: () => false })).toBe(false);
  });
});
