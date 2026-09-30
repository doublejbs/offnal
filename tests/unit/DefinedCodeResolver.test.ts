import { describe, expect, it } from 'vitest';

import { listUndefinedCodes, resolveDefinedCodes } from '@/domain/DefinedCodeResolver';
import { PublishBlockReason } from '@/domain/enums/PublishBlockReason';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { getPublishBlockers } from '@/domain/ScheduleValidator';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const definition = (code: string, patch: Partial<ShiftDefinition> = {}): ShiftDefinition => ({
  code,
  label: code,
  startTime: null,
  endTime: null,
  endsNextDay: null,
  isOff: false,
  ...patch,
});

const undefinedEntry = (date: string, code: string, extra: ShiftReviewReason[] = []): ShiftEntry => ({
  date,
  code,
  reviewReasons: [...extra, ShiftReviewReason.UNDEFINED_CODE],
  confirmed: false,
});

const D = definition('D', { startTime: '07:00', endTime: '16:00', endsNextDay: false });

describe('resolveDefinedCodes', () => {
  it('confirms entries of a code once its times are complete', () => {
    const entries = [undefinedEntry('2026-11-01', 'W'), undefinedEntry('2026-11-02', 'W')];
    const resolved = resolveDefinedCodes(entries, [
      D,
      definition('W', { startTime: '09:00', endTime: '18:00', endsNextDay: false }),
    ]);

    expect(resolved).toEqual([
      { date: '2026-11-01', code: 'W', reviewReasons: [], confirmed: true },
      { date: '2026-11-02', code: 'W', reviewReasons: [], confirmed: true },
    ]);
  });

  it('confirms entries of a code defined as a day off', () => {
    const resolved = resolveDefinedCodes(
      [undefinedEntry('2026-11-03', '연차')],
      [definition('연차', { isOff: true })],
    );

    expect(resolved[0]).toEqual({ date: '2026-11-03', code: '연차', reviewReasons: [], confirmed: true });
  });

  it('removes only UNDEFINED_CODE and keeps other reasons unconfirmed', () => {
    const resolved = resolveDefinedCodes(
      [undefinedEntry('2026-11-04', 'W', [ShiftReviewReason.AMBIGUOUS])],
      [definition('W', { isOff: true })],
    );

    expect(resolved[0]).toEqual({
      date: '2026-11-04',
      code: 'W',
      reviewReasons: [ShiftReviewReason.AMBIGUOUS],
      confirmed: false,
    });
  });

  it('keeps entries whose definition is incomplete or inconsistent', () => {
    const entries = [
      undefinedEntry('2026-11-05', 'W'),
      undefinedEntry('2026-11-06', 'M'),
      undefinedEntry('2026-11-07', 'Q'),
    ];
    const resolved = resolveDefinedCodes(entries, [
      definition('W', { startTime: '09:00', endTime: '18:00' }),
      definition('M', { startTime: '18:00', endTime: '09:00', endsNextDay: false }),
    ]);

    expect(resolved).toEqual(entries);
  });

  it('leaves unrelated entries untouched (same objects)', () => {
    const confirmed: ShiftEntry = { date: '2026-11-08', code: 'D', reviewReasons: [], confirmed: true };
    const ambiguous: ShiftEntry = {
      date: '2026-11-09',
      code: 'D',
      reviewReasons: [ShiftReviewReason.AMBIGUOUS],
      confirmed: false,
    };
    const unreadable: ShiftEntry = {
      date: '2026-11-10',
      code: null,
      reviewReasons: [ShiftReviewReason.UNREADABLE],
      confirmed: false,
    };
    const resolved = resolveDefinedCodes([confirmed, ambiguous, unreadable], [D]);

    expect(resolved[0]).toBe(confirmed);
    expect(resolved[1]).toBe(ambiguous);
    expect(resolved[2]).toBe(unreadable);
  });

  it('never confirms an entry without a code', () => {
    const entry: ShiftEntry = {
      date: '2026-11-11',
      code: null,
      reviewReasons: [ShiftReviewReason.UNDEFINED_CODE],
      confirmed: false,
    };

    expect(resolveDefinedCodes([entry], [D])[0]).toBe(entry);
  });

  it('clears the publish blockers of the defined code', () => {
    const entries = [
      { date: '2026-11-01', code: 'D', reviewReasons: [], confirmed: true },
      undefinedEntry('2026-11-02', 'W'),
    ];
    const definitions = [D, definition('W')];

    expect(getPublishBlockers(entries, definitions).map((blocker) => blocker.reason)).toEqual([
      PublishBlockReason.UNCONFIRMED_DATES,
      PublishBlockReason.MISSING_TIMES,
    ]);

    const completed = [D, definition('W', { isOff: true })];

    expect(getPublishBlockers(resolveDefinedCodes(entries, completed), completed)).toEqual([]);
  });
});

describe('listUndefinedCodes', () => {
  it('lists codes still flagged UNDEFINED_CODE once, in date order', () => {
    const entries = [
      { date: '2026-11-01', code: 'D', reviewReasons: [], confirmed: true },
      undefinedEntry('2026-11-02', '연차'),
      undefinedEntry('2026-11-03', 'W', [ShiftReviewReason.AMBIGUOUS]),
      undefinedEntry('2026-11-04', '연차'),
    ];

    expect(listUndefinedCodes(entries)).toEqual(['연차', 'W']);
    expect(listUndefinedCodes([])).toEqual([]);
  });
});
