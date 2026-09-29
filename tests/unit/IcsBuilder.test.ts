import { describe, expect, it } from 'vitest';

import { buildIcs } from '@/domain/IcsBuilder';
import { type IcsBuildInput } from '@/domain/types/IcsBuildInput';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const DEFINITIONS: ShiftDefinition[] = [
  { code: 'D', label: '데이', startTime: '07:00', endTime: '16:00', endsNextDay: false, isOff: false },
  { code: 'N', label: '나이트', startTime: '22:00', endTime: '07:00', endsNextDay: true, isOff: false },
  { code: 'OFF', label: '휴무', startTime: null, endTime: null, endsNextDay: null, isOff: true },
  {
    code: 'S',
    label: 'Day, early; shift',
    startTime: '09:00',
    endTime: '18:00',
    endsNextDay: false,
    isOff: false,
  },
];

const entry = (date: string, code: string): ShiftEntry => ({
  date,
  code,
  reviewReasons: [],
  confirmed: true,
});

const buildInput = (overrides: Partial<IcsBuildInput> = {}): IcsBuildInput => ({
  calendarId: 'cal-123',
  displayName: '김하루',
  yearMonth: '2026-10',
  entries: [entry('2026-10-01', 'D'), entry('2026-10-02', 'OFF'), entry('2026-10-31', 'N')],
  definitions: DEFINITIONS,
  includeOff: false,
  generatedAt: new Date('2026-09-29T03:04:05Z'),
  ...overrides,
});

const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');

const getEvents = (ics: string): string[] =>
  unfold(ics)
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((block) => block.split('END:VEVENT')[0] ?? '');

describe('IcsBuilder.buildIcs', () => {
  it('builds a calendar with PRODID and DTSTAMP', () => {
    const ics = unfold(buildIcs(buildInput()));

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('PRODID:offnal');
    expect(ics).toContain('DTSTAMP:20260929T030405Z');
    expect(ics).toContain('X-WR-CALNAME:');
  });

  it('excludes off days by default', () => {
    const events = getEvents(buildIcs(buildInput()));

    expect(events).toHaveLength(2);
    expect(events.some((event) => event.includes('휴무'))).toBe(false);
  });

  it('includes off days as all-day events with exclusive end', () => {
    const events = getEvents(buildIcs(buildInput({ includeOff: true })));
    const off = events.find((event) => event.includes('UID:cal-123-2026-10-02@offnal'));

    expect(events).toHaveLength(3);
    expect(off).toContain('DTSTART;VALUE=DATE:20261002');
    expect(off).toContain('DTEND;VALUE=DATE:20261003');
    expect(off).toContain('SUMMARY:휴무 (OFF)');
  });

  it('writes timed events in UTC with KST conversion', () => {
    const events = getEvents(buildIcs(buildInput()));
    const day = events.find((event) => event.includes('UID:cal-123-2026-10-01@offnal'));

    expect(day).toContain('DTSTART:20260930T220000Z');
    expect(day).toContain('DTEND:20261001T070000Z');
    expect(day).toContain('SUMMARY:데이 (D)');
    expect(day).toContain('DESCRIPTION:오프날에서 가져온 일정 · 이후 변경은 자동 반영되지 않아요');
  });

  it('ends the 10/31 night shift on 11/01', () => {
    const events = getEvents(buildIcs(buildInput()));
    const night = events.find((event) => event.includes('UID:cal-123-2026-10-31@offnal'));

    expect(night).toContain('DTSTART:20261031T130000Z');
    expect(night).toContain('DTEND:20261031T220000Z');
  });

  it('ends the 12/31 night shift in the next year', () => {
    const ics = buildIcs(
      buildInput({
        yearMonth: '2026-12',
        entries: [entry('2026-12-31', 'N')],
        definitions: [{ ...DEFINITIONS[1]!, endTime: '10:00' }],
      }),
    );

    expect(unfold(ics)).toContain('DTEND:20270101T010000Z');
  });

  it('handles leap-day night shifts', () => {
    const ics = unfold(
      buildIcs(
        buildInput({
          yearMonth: '2028-02',
          entries: [entry('2028-02-28', 'N'), entry('2028-02-29', 'N')],
          definitions: [{ ...DEFINITIONS[1]!, endTime: '10:00' }],
        }),
      ),
    );

    expect(ics).toContain('DTEND:20280229T010000Z');
    expect(ics).toContain('DTEND:20280301T010000Z');
  });

  it('uses stable UIDs across builds', () => {
    const first = getEvents(buildIcs(buildInput()));
    const second = getEvents(buildIcs(buildInput({ generatedAt: new Date('2026-10-05T00:00:00Z') })));
    const extractUids = (events: string[]) => events.map((event) => /UID:(.*)/.exec(event)?.[1]?.trim());

    expect(extractUids(first)).toEqual(['cal-123-2026-10-01@offnal', 'cal-123-2026-10-31@offnal']);
    expect(extractUids(second)).toEqual(extractUids(first));
  });

  it('escapes commas and semicolons in labels', () => {
    const ics = unfold(buildIcs(buildInput({ entries: [entry('2026-10-05', 'S')] })));

    expect(ics).toContain('SUMMARY:Day\\, early\\; shift (S)');
  });

  it('skips entries without a code or definition', () => {
    const ics = buildIcs(
      buildInput({
        entries: [
          { date: '2026-10-03', code: null, reviewReasons: [], confirmed: false },
          entry('2026-10-04', 'Q'),
        ],
      }),
    );

    expect(getEvents(ics)).toHaveLength(0);
    expect(ics).toContain('BEGIN:VCALENDAR');
  });
});
