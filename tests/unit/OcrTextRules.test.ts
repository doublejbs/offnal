import { describe, expect, it } from 'vitest';

import {
  buildCodeWhitelist,
  isCodeShaped,
  matchCode,
  normalizeToken,
  selectFrequentTokens,
} from '@/server/vision/ocr/CodeDictionary';
import { isWeekdayRow, parseDayNumber, validateDayHeader } from '@/server/vision/ocr/HeaderValidator';
import { parseLegendDefinitions, parseTitleYearMonth } from '@/server/vision/ocr/TextPatterns';

const days = (count: number) => Array.from({ length: count }, (_value, index) => index + 1);

describe('day header contiguity', () => {
  it('accepts 1…N with a few misreads and finds day 1 after the name column', () => {
    const values: (number | null)[] = [null, ...days(31)];

    values[10] = null;
    values[20] = 7;

    expect(validateDayHeader(values)).toEqual({ firstColumn: 1, dayCount: 31, matchedDays: 29 });
    expect(validateDayHeader(days(30))).toMatchObject({ firstColumn: 0, dayCount: 30 });
  });

  it('rejects non-contiguous or too short headers', () => {
    expect(validateDayHeader(days(20))).toBeNull();
    expect(validateDayHeader(days(31).map((day) => (day % 2 === 0 ? null : day)))).toBeNull();
    expect(parseDayNumber(' 31 ')).toBe(31);
    expect(parseDayNumber('32')).toBeNull();
    expect(parseDayNumber('3l')).toBeNull();
    expect(isWeekdayRow(['수', '목', '금', '토', '', '월', '화'])).toBe(true);
    expect(isWeekdayRow(['D', 'E', 'OFF', '수'])).toBe(false);
  });
});

describe('code dictionary', () => {
  it('builds per-script whitelists from the codes', () => {
    expect(buildCodeWhitelist(['D', 'OFF', 'E', '연차', 'off'])).toEqual({ latin: 'DEFO', hangul: '연차' });
  });

  it('keeps only tokens read confidently at least twice', () => {
    const readings = [
      { token: 'W', confidence: 90 },
      { token: 'W', confidence: 85 },
      { token: 'QFF', confidence: 95 },
      { token: 'M', confidence: 40 },
      { token: 'M', confidence: 30 },
      { token: 'TOOLONG', confidence: 99 },
      { token: 'TOOLONG', confidence: 99 },
    ];

    expect(selectFrequentTokens(readings, 2, 80)).toEqual(['W']);
    expect(isCodeShaped('연차')).toBe(true);
    expect(isCodeShaped('D연')).toBe(false);
  });

  it('matches only exact confident dictionary tokens, never the nearest code', () => {
    const dictionary = new Set(['D', 'OFF', '연차']);

    expect(normalizeToken(' o|f f ')).toBe('OFF');
    expect(matchCode({ token: 'off', confidence: 90 }, dictionary, 60)).toEqual({
      code: 'OFF',
      token: 'OFF',
    });
    expect(matchCode({ token: 'OF', confidence: 95 }, dictionary, 60).code).toBeNull();
    expect(matchCode({ token: 'D', confidence: 20 }, dictionary, 60).code).toBeNull();
    expect(matchCode({ token: '연 차', confidence: 80 }, dictionary, 60).code).toBe('연차');
    expect(matchCode({ token: '', confidence: 99 }, dictionary, 60).code).toBeNull();
  });
});

describe('title and legend text', () => {
  it('reads the month from OCR-garbled titles', () => {
    expect(parseTitleYearMonth("간호팀  2026 년'7월 근무표")).toBe('2026-07');
    expect(parseTitleYearMonth('2026 년 10 뭘 、 근무표')).toBe('2026-10');
    expect(parseTitleYearMonth('간호팀 2026 년 8 ： 근무표')).toBe('2026-08');
    expect(parseTitleYearMonth('2026 13월')).toBeNull();
    expect(parseTitleYearMonth('근무표')).toBeNull();
  });

  it('parses legend codes and times, including misread slashes and next-day ends', () => {
    const parsed = parseLegendDefinitions(
      'DZ5 07:00 ~ 16:00 TEES 13:00 ~ 22:00 INZ2 21:30~ 07:30 | ST% 1000 ~ 19:00 /YZ2 08:00 19:00\nD, S, Y 휴게',
    );

    expect(parsed.map((item) => [item.code, item.startTime, item.endTime, item.endsNextDay])).toEqual([
      ['D', '07:00', '16:00', false],
      ['E', '13:00', '22:00', false],
      ['N', '21:30', '07:30', true],
      ['S', '10:00', '19:00', false],
      ['Y', '08:00', '19:00', false],
    ]);
    expect(parseLegendDefinitions('D258 07:00~16:00')[0]?.startTime).toBe('07:00');
    expect(parseLegendDefinitions('없음 25:00 ~ 26:00')).toEqual([]);
  });
});
