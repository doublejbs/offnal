/**
 * Generates the share preview and app icons from inline SVG (Spec §14).
 *
 *   pnpm exec tsx scripts/GenerateBrandImages.ts
 *
 * Outputs public/og-image.png (1200x630), src/app/icon.png (512) and src/app/apple-icon.png (180).
 * Korean text is rendered by librsvg through fontconfig, so run it on macOS (Apple SD Gothic Neo)
 * or a machine with a Korean font installed, then check the PNGs visually before committing.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const FONT_FAMILY = "'Apple SD Gothic Neo', 'Noto Sans KR', 'Noto Sans CJK KR', 'Malgun Gothic', sans-serif";

const COLOR = {
  bg: '#f4f6fb',
  card: '#ffffff',
  ink: '#172034',
  sub: '#667085',
  line: '#e7ebf2',
  blue: '#3155e7',
  blueFill: '#edf1ff',
};

enum ShiftCode {
  D = 'D',
  E = 'E',
  N = 'N',
  S = 'S',
  OFF = 'OFF',
}

type BadgeColor = { fg: string; bg: string };

// Light-theme badge colors from the prototype CSS (docs/Handoff.md Appendix B).
const BADGE_COLORS: Record<ShiftCode, BadgeColor> = {
  [ShiftCode.D]: { fg: '#2455be', bg: '#e9f1ff' },
  [ShiftCode.E]: { fg: '#7844a7', bg: '#f1e9fa' },
  [ShiftCode.N]: { fg: '#384c79', bg: '#e5eaf4' },
  [ShiftCode.S]: { fg: '#8c611f', bg: '#fff0d8' },
  [ShiftCode.OFF]: { fg: COLOR.sub, bg: COLOR.bg },
};

const { D, E, N, S, OFF } = ShiftCode;

// Virtual October 2026 (the prototype sample); no real schedule data.
const SAMPLE_SHIFTS: ShiftCode[] = [
  OFF, D, D, E, E, OFF, S, D, D, OFF, OFF, E, E, N, N, N, OFF, OFF, D, D, E, E, OFF, S, OFF, D, D, E, OFF, OFF, S,
];
const SAMPLE_FIRST_WEEKDAY = 4; // 2026-10-01 is a Thursday
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const badge = (code: ShiftCode, x: number, y: number, width: number, height: number, fontSize: number): string => {
  const color = BADGE_COLORS[code];
  const radius = Math.round(height / 3);

  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${color.bg}"/>` +
    `<text x="${x + width / 2}" y="${y + height / 2}" dy="0.36em" text-anchor="middle" font-size="${fontSize}" ` +
    `font-weight="600" fill="${color.fg}">${code}</text>`
  );
};

/** Mini month card on the right, outside the centered 630px square so a 1:1 crop keeps only the text. */
const buildCalendarCard = (x: number, y: number): string => {
  const width = 236;
  const padding = 14;
  const columnWidth = (width - padding * 2) / 7;
  const gridTop = y + 76;
  const rowHeight = 48;
  const rows = Math.ceil((SAMPLE_FIRST_WEEKDAY + SAMPLE_SHIFTS.length) / 7);
  const height = gridTop - y + rows * rowHeight + 6;

  const header =
    `<text x="${x + padding + 2}" y="${y + 32}" font-size="16" font-weight="700" fill="${COLOR.ink}">2026년 10월</text>` +
    `<text x="${x + width - padding - 2}" y="${y + 32}" text-anchor="end" font-size="11" fill="${COLOR.sub}">내 근무</text>`;

  const weekdays = WEEKDAY_NAMES.map(
    (name, index) =>
      `<text x="${x + padding + columnWidth * (index + 0.5)}" y="${y + 60}" text-anchor="middle" font-size="10" ` +
      `fill="${COLOR.sub}">${name}</text>`,
  ).join('');

  const days = SAMPLE_SHIFTS.map((code, index) => {
    const cell = SAMPLE_FIRST_WEEKDAY + index;
    const centerX = x + padding + columnWidth * ((cell % 7) + 0.5);
    const top = gridTop + Math.floor(cell / 7) * rowHeight;

    return (
      `<text x="${centerX}" y="${top + 12}" text-anchor="middle" font-size="10" fill="${COLOR.ink}">${index + 1}</text>` +
      badge(code, centerX - 13, top + 20, 26, 16, code === OFF ? 8 : 10)
    );
  }).join('');

  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="${COLOR.card}" stroke="${COLOR.line}"/>` +
    header +
    weekdays +
    days
  );
};

/** Day detail card on the left, mirroring the calendar card. */
const buildDayCard = (x: number, y: number): string => {
  const width = 236;
  const padding = 20;
  const check = (top: number, label: string): string =>
    `<circle cx="${x + padding + 9}" cy="${top}" r="9" fill="${COLOR.blueFill}"/>` +
    `<path d="M${x + padding + 5} ${top} l3 3 l5 -6" fill="none" stroke="${COLOR.blue}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="${x + padding + 26}" y="${top}" dy="0.36em" font-size="14" fill="${COLOR.ink}">${label}</text>`;

  return (
    `<rect x="${x}" y="${y}" width="${width}" height="236" rx="20" fill="${COLOR.card}" stroke="${COLOR.line}"/>` +
    `<text x="${x + padding}" y="${y + 36}" font-size="12" font-weight="700" fill="${COLOR.blue}">오늘 근무</text>` +
    `<text x="${x + padding}" y="${y + 68}" font-size="20" font-weight="700" fill="${COLOR.ink}">10월 15일 (목)</text>` +
    badge(N, x + padding, y + 86, 44, 26, 14) +
    `<text x="${x + padding + 56}" y="${y + 99}" dy="0.36em" font-size="13" fill="${COLOR.sub}">21:30–07:30</text>` +
    `<line x1="${x + padding}" y1="${y + 136}" x2="${x + width - padding}" y2="${y + 136}" stroke="${COLOR.line}"/>` +
    check(y + 166, '캘린더에 추가') +
    check(y + 202, '링크로 공유')
  );
};

const buildLegend = (centerY: number): string => {
  const codes = [D, E, N, S, OFF];
  const badgeWidth = 52;
  const gap = 12;
  const totalWidth = codes.length * badgeWidth + (codes.length - 1) * gap;
  const startX = (OG_WIDTH - totalWidth) / 2;

  // White pill behind the badges so the OFF badge (soft gray) stays visible on the page background.
  const pill =
    `<rect x="${startX - 10}" y="${centerY - 25}" width="${totalWidth + 20}" height="50" rx="25" ` +
    `fill="${COLOR.card}" stroke="${COLOR.line}"/>`;

  return (
    pill +
    codes.map((code, index) => badge(code, startX + index * (badgeWidth + gap), centerY - 15, badgeWidth, 30, 15)).join('')
  );
};

const buildOgSvg = (): string => `
<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="100%" height="100%" fill="${COLOR.bg}"/>
  <g font-family="${FONT_FAMILY}">
    <text x="600" y="172" text-anchor="middle" font-size="40" font-weight="700" letter-spacing="-1.5" fill="${COLOR.ink}">오프<tspan fill="${COLOR.blue}">날</tspan></text>
    <text x="600" y="284" text-anchor="middle" font-size="64" font-weight="800" letter-spacing="-2" fill="${COLOR.ink}">근무표 한 장이면</text>
    <text x="600" y="366" text-anchor="middle" font-size="64" font-weight="800" letter-spacing="-2" fill="${COLOR.ink}">이번 달 준비 끝.</text>
    <text x="600" y="432" text-anchor="middle" font-size="23" font-weight="500" fill="${COLOR.sub}">내 근무만 달력으로 · 캘린더 추가 · 링크 공유</text>
    ${buildLegend(500)}
    ${buildDayCard(36, 197)}
    ${buildCalendarCard(928, 154)}
  </g>
</svg>`;

/** Blue rounded square with the white wordmark; apple-icon is full-bleed because iOS rounds it itself. */
const buildIconSvg = (size: number, isRounded: boolean): string => {
  const radius = isRounded ? 112 : 0; // in the 512 viewBox, about 22% like platform icon masks

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${COLOR.blue}"/>
  <text x="256" y="256" dy="0.36em" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="124"
    font-weight="800" letter-spacing="2" fill="#ffffff">오프날</text>
</svg>`;
};

const renderPng = async (svg: string, outputPath: string): Promise<void> => {
  const target = path.join(ROOT, outputPath);

  await mkdir(path.dirname(target), { recursive: true });

  const info = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, effort: 10 }).toFile(target);

  console.log(`${outputPath} ${info.width}x${info.height} ${Math.round(info.size / 1024)}KB`);
};

await renderPng(buildOgSvg(), 'public/og-image.png');
await renderPng(buildIconSvg(512, true), 'src/app/icon.png');
await renderPng(buildIconSvg(180, false), 'src/app/apple-icon.png');
