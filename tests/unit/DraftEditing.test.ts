import { describe, expect, it } from 'vitest';

import {
  addDefinition,
  applyCodeToDate,
  removeDefinition,
  updateDefinition,
  updateDefinitionAndResolve,
  validateDraftInput,
} from '@/client/DraftEditing';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const definitions: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: null, endTime: null, endsNextDay: null, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
];

const entries: ShiftEntry[] = [
  { date: '2026-10-14', code: 'E', reviewReasons: [ShiftReviewReason.AMBIGUOUS], confirmed: false },
  { date: '2026-10-15', code: 'D', reviewReasons: [], confirmed: true },
];

describe('DraftEditing', () => {
  it('confirms a date and clears review reasons when a code is chosen', () => {
    const next = applyCodeToDate(entries, '2026-10-14', 'D');

    expect(next[0]).toEqual({ date: '2026-10-14', code: 'D', reviewReasons: [], confirmed: true });
    expect(next[1]).toBe(entries[1]);
  });

  it('marks a date unconfirmed when 미확인 is chosen', () => {
    const next = applyCodeToDate(entries, '2026-10-15', null);

    expect(next[1]).toEqual({ date: '2026-10-15', code: null, reviewReasons: [], confirmed: false });
  });

  it('adds a normalized custom code with empty times', () => {
    const result = addDefinition(definitions, ' vac ', '휴가');

    expect(result.error).toBeNull();
    expect(result.definitions.at(-1)).toEqual({
      code: 'VAC',
      label: '휴가',
      startTime: null,
      endTime: null,
      endsNextDay: null,
      isOff: false,
    });
  });

  it('rejects duplicate, empty and over-long codes', () => {
    expect(addDefinition(definitions, 'd', '').error).toBe('이미 있는 코드예요.');
    expect(addDefinition(definitions, '  ', '').error).toBe('코드를 입력해 주세요.');
    expect(addDefinition(definitions, 'ABCDEFGHIJKLM', '').error).toBe('코드는 12자까지 입력할 수 있어요.');
  });

  it('infers the next-day flag from explicit start and end times', () => {
    const overnight = updateDefinition(definitions, 'D', { startTime: '22:00' });
    const withEnd = updateDefinition(overnight, 'D', { endTime: '07:00' });

    expect(overnight[0]?.endsNextDay).toBeNull();
    expect(withEnd[0]?.endsNextDay).toBe(true);
    expect(updateDefinition(withEnd, 'D', { endTime: '23:00' })[0]?.endsNextDay).toBe(false);
  });

  it('clears times when a code becomes an off code', () => {
    const timed = updateDefinition(definitions, 'D', { startTime: '07:00', endTime: '16:00' });
    const off = updateDefinition(timed, 'D', { isOff: true });

    expect(off[0]).toMatchObject({ isOff: true, startTime: null, endTime: null, endsNextDay: null });
  });

  it('removes only unused codes', () => {
    expect(removeDefinition(definitions, entries, 'D')).toBeNull();
    expect(removeDefinition(definitions, entries, 'OFF')).toEqual([definitions[0]]);
  });

  it('validates the name and labels before autosaving', () => {
    expect(validateDraftInput('김하루', definitions)).toBeNull();
    expect(validateDraftInput('  ', definitions)).toBe('이름을 입력해 주세요.');
    expect(validateDraftInput('김하루', [{ ...definitions[0]!, label: ' ' }])).toBe(
      'D 코드의 이름을 입력해 주세요.',
    );
    expect(validateDraftInput('가'.repeat(41), definitions)).toBe('이름은 40자까지 입력할 수 있어요.');
  });

  it('confirms dates of an undefined code as soon as its definition is complete', () => {
    const draft = {
      definitions: [
        ...definitions,
        { code: 'W', label: 'W', startTime: null, endTime: null, endsNextDay: null, isOff: false },
      ],
      entries: [
        ...entries,
        {
          date: '2026-10-16',
          code: 'W',
          reviewReasons: [ShiftReviewReason.UNDEFINED_CODE],
          confirmed: false,
        },
      ],
    };
    const partial = updateDefinitionAndResolve(draft, 'W', { startTime: '09:00' });

    expect(partial.entries[2]).toMatchObject({ code: 'W', confirmed: false });

    const complete = updateDefinitionAndResolve(partial, 'W', { endTime: '18:00' });

    expect(complete.definitions[2]).toMatchObject({ endsNextDay: false });
    expect(complete.entries[2]).toEqual({
      date: '2026-10-16',
      code: 'W',
      reviewReasons: [],
      confirmed: true,
    });
    expect(complete.entries[0]).toBe(entries[0]);
  });
});
