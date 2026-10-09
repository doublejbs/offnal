import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTodaySnapshot, subscribeToSeoulDay } from '@/components/calendar/UseTodayInSeoul';

/** Subscription path of useTodayInSeoul (§25): midnight timer plus wake-up events, on stub window/document. */

type StubDocument = EventTarget & { visibilityState: DocumentVisibilityState };

let stubWindow: EventTarget;
let stubDocument: StubDocument;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T14:59:00Z'));
  stubWindow = new EventTarget();
  stubDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  vi.stubGlobal('window', stubWindow);
  vi.stubGlobal('document', stubDocument);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useTodayInSeoul subscription', () => {
  it('notifies once just after Seoul midnight and re-arms for the next one', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToSeoulDay(onChange);

    expect(getTodaySnapshot()).toBe('2026-10-09');

    vi.advanceTimersByTime(59_000);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(getTodaySnapshot()).toBe('2026-10-10');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('re-evaluates on wake-up events when the timer stalled (sleep / bfcache)', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToSeoulDay(onChange);

    // Device slept past midnight: the clock moved but the timer did not fire.
    vi.setSystemTime(new Date('2026-10-09T23:00:00Z'));

    stubDocument.visibilityState = 'hidden';
    stubDocument.dispatchEvent(new Event('visibilitychange'));
    expect(onChange).not.toHaveBeenCalled();

    stubDocument.visibilityState = 'visible';
    stubDocument.dispatchEvent(new Event('visibilitychange'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(getTodaySnapshot()).toBe('2026-10-10');

    stubWindow.dispatchEvent(new Event('pageshow'));
    stubWindow.dispatchEvent(new Event('focus'));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    // Re-armed from the new time: next Seoul midnight is 2026-10-10T15:00Z (16h later), plus slack.
    vi.advanceTimersByTime(16 * 60 * 60 * 1000 - 1);
    expect(onChange).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(2_000);
    expect(onChange).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it('clears the timer and every listener on unsubscribe', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToSeoulDay(onChange);

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);

    stubDocument.dispatchEvent(new Event('visibilitychange'));
    stubWindow.dispatchEvent(new Event('pageshow'));
    stubWindow.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
