import { readFile } from 'node:fs/promises';

import { type Download, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

import { formatYearMonthLabel } from '@/domain/YearMonth';

import {
  addMonths,
  buildExpectedCodes,
  countWorkAndOff,
  DEFAULT_FIXES,
  devLoginViaApi,
  getMockYearMonth,
  MOCK_NAMES,
  publishMonthViaApi,
  uniqueName,
} from './support/ApiFlow';
import { newIsolatedContext, saveScreenshot, test } from './support/OffnalTest';

const EXPIRED_TEXT = '링크가 만료되었거나 공유가 중지되었어요.';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_PNG_WIDTH = 2160;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const readDownload = async (download: Download): Promise<Buffer> => readFile(await download.path());

/** Unfolds RFC 5545 lines and splits the calendar into VEVENT blocks. */
const parseEvents = (ics: string): Record<string, string>[] => {
  const lines = ics.replace(/\r\n[ \t]/g, '').split(/\r\n/);
  const events: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT' && current) {
      events.push(current);
      current = null;
    } else if (current) {
      const separator = line.indexOf(':');
      const key = line.slice(0, separator).split(';')[0] ?? '';

      current[key] = line.slice(separator + 1);
    }
  }

  return events;
};

/** 20261005T133000Z → KST calendar date "2026-10-05". */
const toKstDate = (value: string): string => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);

  if (!match) {
    throw new Error(`Not a UTC date-time: ${value}`);
  }

  const [, year, month, day, hour, minute] = match.map(Number);
  const utc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);

  return new Date(utc + KST_OFFSET_MS).toISOString().slice(0, 10);
};

const openPanel = async (page: Page, title: string): Promise<void> => {
  await page.getByRole('button', { name: new RegExp(title) }).click();
};

const confirmDialog = async (page: Page, label: string): Promise<void> => {
  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label }).click();
  await expect(dialog).toBeHidden();
};

test('공유 링크 생성·열람·재발급·중지, ICS·PNG 내보내기', async ({ page, browser }) => {
  const monthA = getMockYearMonth();
  const monthB = addMonths(monthA, 1);

  await devLoginViaApi(page.request, uniqueName('공유'));
  await publishMonthViaApi(page.request, { yearMonth: monthA });
  // Month B is published but never made visible on the link.
  await publishMonthViaApi(page.request, { yearMonth: monthB });

  await page.goto(`/calendar/${monthA}/share`);
  await expect(page.getByRole('heading', { name: /편한 방식으로/ })).toBeVisible();

  // Link: create → copy → read the URL from the visible field.
  await openPanel(page, '링크로 공유');
  await expect(page.getByRole('checkbox', { name: formatYearMonthLabel(monthA) })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: formatYearMonthLabel(monthB) })).not.toBeChecked();
  await page.getByRole('button', { name: '공유 링크 만들기' }).click();

  const linkField = page.getByRole('textbox', { name: '공유 링크' });

  await expect(linkField).toHaveValue(/\/s\/[A-Za-z0-9_-]+$/);
  await page.getByRole('button', { name: '링크 복사' }).click();
  await expect(page.getByText('링크를 복사했어요. 원하는 곳에 붙여 넣어 보내 주세요.')).toBeVisible();

  const firstUrl = await linkField.inputValue();

  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstUrl);
  await saveScreenshot(page, 'share-link');

  // Recipient: new context without cookies.
  const guestContext = await newIsolatedContext(browser, page);
  const guest = await guestContext.newPage();

  await guest.goto(firstUrl);
  await expect(guest.getByText('김하루님의 근무')).toBeVisible();
  await expect(guest.getByRole('heading', { name: formatYearMonthLabel(monthA) })).toBeVisible();
  await expect(guest.getByText('공유받은 달력은 읽기 전용이에요.')).toBeVisible();

  const guestHtml = await guest.content();

  for (const name of MOCK_NAMES.filter((item) => item !== '김하루')) {
    expect(guestHtml).not.toContain(name);
  }

  for (const label of [
    '근무 수정',
    '공유·내보내기',
    '다음 달 등록',
    '이 달 달력 삭제',
    '미확인',
    '코드 추가',
  ]) {
    await expect(guest.getByRole('button', { name: label })).toHaveCount(0);
    await expect(guest.getByRole('link', { name: label })).toHaveCount(0);
  }

  await expect(guest.getByRole('group', { name: '근무 코드 선택' })).toHaveCount(0);
  await expect(guest.getByText('원본 사진')).toHaveCount(0);
  await saveScreenshot(guest, 'shared');

  // A published but not shared month is not reachable through ?month=.
  await guest.goto(`${firstUrl}?month=${monthB}`);
  await expect(guest.getByText(EXPIRED_TEXT)).toBeVisible();
  await expect(guest.getByRole('heading', { name: formatYearMonthLabel(monthB) })).toHaveCount(0);

  const hiddenResponse = await guestContext.request.get(
    `/api/shared/${firstUrl.split('/s/')[1] ?? ''}?month=${monthB}`,
  );

  expect(hiddenResponse.status()).toBe(404);

  // Rotate: the old link expires, the new one works.
  await page.getByRole('button', { name: '링크 재발급' }).click();
  await confirmDialog(page, '재발급');
  await expect(page.getByText('새 링크를 만들었어요. 이전 링크는 더 이상 열리지 않아요.')).toBeVisible();
  await expect(linkField).not.toHaveValue(firstUrl);

  const secondUrl = await linkField.inputValue();

  await guest.goto(firstUrl);
  await expect(guest.getByText(EXPIRED_TEXT)).toBeVisible();
  await guest.goto(secondUrl);
  await expect(guest.getByText('김하루님의 근무')).toBeVisible();

  // Stop sharing: the current link expires too.
  await page.getByRole('button', { name: '공유 중지' }).click();
  await confirmDialog(page, '공유 중지');
  await expect(page.getByText('공유를 중지했어요. 이전 링크는 더 이상 열리지 않아요.')).toBeVisible();
  await expect(linkField).toHaveCount(0);
  await guest.goto(secondUrl);
  await expect(guest.getByText(EXPIRED_TEXT)).toBeVisible();
  await guestContext.close();

  // ICS: work days only by default, off days as all-day events when opted in.
  const counts = countWorkAndOff(buildExpectedCodes(monthA, 0, DEFAULT_FIXES));

  await openPanel(page, '내 캘린더에 추가');

  const icsButton = page.getByRole('button', { name: '일정 파일 받기' });
  const [icsDownload] = await Promise.all([page.waitForEvent('download'), icsButton.click()]);

  expect(icsDownload.suggestedFilename()).toBe(`offnal-${monthA}.ics`);

  const ics = (await readDownload(icsDownload)).toString('utf8');

  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('END:VCALENDAR');

  const workEvents = parseEvents(ics);

  expect(workEvents).toHaveLength(counts.workCount);
  expect(new Set(workEvents.map((event) => event.UID)).size).toBe(counts.workCount);

  const nightEvents = workEvents.filter((event) => event.SUMMARY === '나이트 (N)');

  expect(nightEvents.length).toBeGreaterThan(0);

  for (const event of nightEvents) {
    const start = event.DTSTART ?? '';
    const end = event.DTEND ?? '';
    const startDate = toKstDate(start);
    const nextDay = new Date(`${startDate}T00:00:00Z`);

    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    // N = 22:30 → next day 07:30 KST (13:30Z → 22:30Z).
    expect(start).toMatch(/T133000Z$/);
    expect(end).toMatch(/T223000Z$/);
    expect(toKstDate(end)).toBe(nextDay.toISOString().slice(0, 10));
  }

  await page.getByRole('checkbox', { name: '휴무도 종일 일정으로 추가' }).check();

  const [allDownload] = await Promise.all([page.waitForEvent('download'), icsButton.click()]);
  const allEvents = parseEvents((await readDownload(allDownload)).toString('utf8'));

  expect(allEvents).toHaveLength(counts.workCount + counts.offCount);
  expect(allEvents.filter((event) => /^\d{8}$/.test(event.DTSTART ?? ''))).toHaveLength(counts.offCount);
  await saveScreenshot(page, 'share-ics');

  // PNG: real file with the PNG signature at 2x of 1080px.
  await openPanel(page, '달력 이미지 저장');

  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '이미지 저장', exact: true }).click(),
  ]);

  expect(pngDownload.suggestedFilename()).toBe(`offnal-${monthA}.png`);

  const png = await readDownload(pngDownload);

  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

  const metadata = await sharp(png).metadata();

  expect(metadata.format).toBe('png');
  expect(metadata.width).toBe(EXPECTED_PNG_WIDTH);
  await expect(page.getByText('이미지를 저장했어요. 다운로드 폴더나 사진첩을 확인해 주세요.')).toBeVisible();
  await saveScreenshot(page, 'share-png');
});
