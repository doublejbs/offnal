/**
 * SVG of the fictional ward roster used by the sample trial (Spec §26.3), drawn from SampleTryData so the
 * picture and the "recognized" data cannot drift apart. Rendered to PNG by GenerateSampleRoster.ts.
 * Every code cell carries `data-cell="<rowId>-<day>"` (and `data-review` on the smudged one) so tests can
 * compare the drawing with the data.
 */
import { SAMPLE_DEFINITIONS } from '@/client/SamplePreviewData';
import { SAMPLE_ROSTER, SAMPLE_TRY_YEAR_MONTH } from '@/client/SampleTryData';
import { dayOfDate, listDates, weekdayOf } from '@/domain/YearMonth';

export const SAMPLE_ROSTER_WIDTH = 1520;
export const SAMPLE_ROSTER_HEIGHT = 560;

const FONT_FAMILY = "'Apple SD Gothic Neo', 'Noto Sans KR', 'Noto Sans CJK KR', 'Malgun Gothic', sans-serif";
const MARGIN_X = 40;
const TABLE_TOP = 112;
const NAME_WIDTH = 120;
const DAY_WIDTH = 44;
const DATE_ROW_HEIGHT = 34;
const WEEKDAY_ROW_HEIGHT = 28;
const PERSON_ROW_HEIGHT = 52;
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const COLOR = {
  paper: '#f7f5ef',
  sheet: '#ffffff',
  ink: '#1f2430',
  sub: '#5f6673',
  line: '#a7adb8',
  strongLine: '#545b68',
  header: '#eef0f4',
  sunday: '#c0392b',
  saturday: '#2a5bb8',
  weekendFill: '#f6f7fa',
  smudge: '#9c8f6c',
};

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const weekdayColor = (weekday: number): string => {
  if (weekday === 0) {
    return COLOR.sunday;
  }

  if (weekday === 6) {
    return COLOR.saturday;
  }

  return COLOR.ink;
};

const codeFontSize = (code: string): number => (code.length > 1 ? 15 : 19);

const buildHeader = (): string => {
  const [year, month] = SAMPLE_TRY_YEAR_MONTH.split('-');

  return (
    `<text x="${MARGIN_X}" y="62" font-size="30" font-weight="700" fill="${COLOR.ink}">` +
    `${Number(year)}년 ${Number(month)}월 근무표</text>` +
    `<text x="${MARGIN_X}" y="92" font-size="16" fill="${COLOR.sub}">병동 간호사 · 예시(가상 이름)</text>` +
    `<text x="${SAMPLE_ROSTER_WIDTH - MARGIN_X}" y="92" text-anchor="end" font-size="15" fill="${COLOR.sub}">` +
    '근무 변경은 미리 알려 주세요</text>'
  );
};

const buildTable = (): string => {
  const dates = listDates(SAMPLE_TRY_YEAR_MONTH);
  const tableWidth = NAME_WIDTH + DAY_WIDTH * dates.length;
  const headerHeight = DATE_ROW_HEIGHT + WEEKDAY_ROW_HEIGHT;
  const tableHeight = headerHeight + PERSON_ROW_HEIGHT * SAMPLE_ROSTER.length;
  const dayX = (index: number): number => MARGIN_X + NAME_WIDTH + DAY_WIDTH * index;
  const parts: string[] = [];

  parts.push(
    `<rect x="${MARGIN_X}" y="${TABLE_TOP}" width="${tableWidth}" height="${tableHeight}" fill="${COLOR.sheet}"/>`,
    `<rect x="${MARGIN_X}" y="${TABLE_TOP}" width="${tableWidth}" height="${headerHeight}" fill="${COLOR.header}"/>`,
  );

  dates.forEach((date, index) => {
    const weekday = weekdayOf(date);
    const centerX = dayX(index) + DAY_WIDTH / 2;
    const color = weekdayColor(weekday);

    if (weekday === 0 || weekday === 6) {
      parts.push(
        `<rect x="${dayX(index)}" y="${TABLE_TOP + headerHeight}" width="${DAY_WIDTH}" ` +
          `height="${PERSON_ROW_HEIGHT * SAMPLE_ROSTER.length}" fill="${COLOR.weekendFill}"/>`,
      );
    }

    parts.push(
      `<text x="${centerX}" y="${TABLE_TOP + 23}" text-anchor="middle" font-size="16" font-weight="600" ` +
        `fill="${color}">${dayOfDate(date)}</text>`,
      `<text x="${centerX}" y="${TABLE_TOP + DATE_ROW_HEIGHT + 19}" text-anchor="middle" font-size="13" ` +
        `fill="${color}">${WEEKDAY_NAMES[weekday]}</text>`,
    );
  });

  parts.push(
    `<text x="${MARGIN_X + NAME_WIDTH / 2}" y="${TABLE_TOP + headerHeight / 2}" dy="0.36em" text-anchor="middle" ` +
      `font-size="16" font-weight="600" fill="${COLOR.ink}">이름</text>`,
  );

  SAMPLE_ROSTER.forEach((person, row) => {
    const top = TABLE_TOP + headerHeight + PERSON_ROW_HEIGHT * row;
    const centerY = top + PERSON_ROW_HEIGHT / 2;

    parts.push(
      `<text x="${MARGIN_X + NAME_WIDTH / 2}" y="${centerY}" dy="0.36em" text-anchor="middle" font-size="18" ` +
        `font-weight="600" fill="${COLOR.ink}">${escapeXml(person.name)}</text>`,
    );

    person.codes.forEach((code, index) => {
      const day = index + 1;
      const centerX = dayX(index) + DAY_WIDTH / 2;
      const isReview = day === person.reviewDay;
      const fill = code === 'OFF' ? COLOR.sub : COLOR.ink;

      if (isReview) {
        // A smudge over the cell: the code is still faintly there, which is what the user checks against.
        parts.push(
          `<ellipse cx="${centerX + 2}" cy="${centerY + 1}" rx="19" ry="15" fill="${COLOR.smudge}" ` +
            'fill-opacity="0.38" filter="url(#smudge)"/>',
        );
      }

      parts.push(
        `<text data-cell="${person.rowId}-${day}"${isReview ? ' data-review="true"' : ''} x="${centerX}" ` +
          `y="${centerY}" dy="0.36em" text-anchor="middle" font-size="${codeFontSize(code)}" font-weight="600" ` +
          `fill="${fill}"${isReview ? ' fill-opacity="0.32" filter="url(#smudge)"' : ''}>${escapeXml(code)}</text>`,
      );
    });
  });

  // Grid lines: thin per cell, strong around the header and the name column.
  for (let index = 0; index <= dates.length; index += 1) {
    const x = dayX(index);

    parts.push(
      `<line x1="${x}" y1="${TABLE_TOP}" x2="${x}" y2="${TABLE_TOP + tableHeight}" stroke="${COLOR.line}" ` +
        'stroke-width="1"/>',
    );
  }

  for (let row = 0; row <= SAMPLE_ROSTER.length; row += 1) {
    const y = TABLE_TOP + headerHeight + PERSON_ROW_HEIGHT * row;

    parts.push(
      `<line x1="${MARGIN_X}" y1="${y}" x2="${MARGIN_X + tableWidth}" y2="${y}" stroke="${COLOR.line}" ` +
        'stroke-width="1"/>',
    );
  }

  parts.push(
    `<line x1="${dayX(0)}" y1="${TABLE_TOP + DATE_ROW_HEIGHT}" x2="${MARGIN_X + tableWidth}" ` +
      `y2="${TABLE_TOP + DATE_ROW_HEIGHT}" stroke="${COLOR.line}" stroke-width="1"/>`,
    `<line x1="${MARGIN_X}" y1="${TABLE_TOP + headerHeight}" x2="${MARGIN_X + tableWidth}" ` +
      `y2="${TABLE_TOP + headerHeight}" stroke="${COLOR.strongLine}" stroke-width="2"/>`,
    `<line x1="${dayX(0)}" y1="${TABLE_TOP}" x2="${dayX(0)}" y2="${TABLE_TOP + tableHeight}" ` +
      `stroke="${COLOR.strongLine}" stroke-width="2"/>`,
    `<rect x="${MARGIN_X}" y="${TABLE_TOP}" width="${tableWidth}" height="${tableHeight}" fill="none" ` +
      `stroke="${COLOR.strongLine}" stroke-width="2"/>`,
  );

  return parts.join('');
};

const buildLegend = (): string => {
  const top =
    TABLE_TOP + DATE_ROW_HEIGHT + WEEKDAY_ROW_HEIGHT + PERSON_ROW_HEIGHT * SAMPLE_ROSTER.length + 42;
  const items = SAMPLE_DEFINITIONS.map((definition) =>
    definition.isOff
      ? `${definition.code} 휴무`
      : `${definition.code} ${definition.startTime}–${definition.endTime}`,
  );

  return (
    `<text x="${MARGIN_X}" y="${top}" xml:space="preserve" font-size="16" fill="${COLOR.sub}">` +
    `${escapeXml(items.join('   ·   '))}</text>`
  );
};

export const buildSampleRosterSvg = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SAMPLE_ROSTER_WIDTH}" height="${SAMPLE_ROSTER_HEIGHT}" ` +
  `viewBox="0 0 ${SAMPLE_ROSTER_WIDTH} ${SAMPLE_ROSTER_HEIGHT}" font-family="${FONT_FAMILY}">` +
  '<defs><filter id="smudge" x="-30%" y="-30%" width="160%" height="160%">' +
  '<feGaussianBlur stdDeviation="1.6"/></filter></defs>' +
  `<rect width="${SAMPLE_ROSTER_WIDTH}" height="${SAMPLE_ROSTER_HEIGHT}" fill="${COLOR.paper}"/>` +
  buildHeader() +
  buildTable() +
  buildLegend() +
  '</svg>';
