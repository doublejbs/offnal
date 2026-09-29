import { expect } from '@playwright/test';

import { formatYearMonthLabel } from '@/domain/YearMonth';

import {
  AMBIGUOUS_DAY,
  buildExpectedCodes,
  countWorkAndOff,
  DEFAULT_FIXES,
  MOCK_NAMES,
  uniqueName,
  UNREADABLE_DAY,
} from './support/ApiFlow';
import { TABLE_IMAGE_SIZE, writePngFixture } from './support/FixtureImages';
import { collectApiBodies, saveScreenshot, test } from './support/OffnalTest';

const SHIFT_CODE_PATTERN = /"(D|E|N|S|OFF)"/;

test('업로드 → 블러 → 데모 로그인 → 이름 선택 → 확인 필요 수정 → 무료 저장 → 달력', async ({
  page,
}, testInfo) => {
  const fixture = await writePngFixture(testInfo, 'schedule-1200x900.png', TABLE_IMAGE_SIZE);
  let isBeforeLogin = true;
  const apiBodies = collectApiBodies(page, () => isBeforeLogin);
  let uploadCount = 0;

  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/recognitions') {
      uploadCount += 1;
    }
  });

  // Hold the process call until the progress screen has been seen (the mock answers in 300ms).
  let releaseProcess = () => {};
  const processGate = new Promise<void>((resolve) => {
    releaseProcess = resolve;
  });

  await page.route('**/api/recognitions/*/process', async (route) => {
    await processGate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /근무표 한 장이면/ })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(fixture);

  // Progress (real stages only) → blur gate.
  await expect(page).toHaveURL(/\/recognitions\/[0-9a-f-]{36}$/);

  const recognitionId = new URL(page.url()).pathname.split('/').at(-1) ?? '';

  await expect(page.getByRole('heading', { name: /읽고 있어요/ })).toBeVisible();
  await expect(page.getByText('사진 업로드 완료')).toBeVisible();
  await saveScreenshot(page, 'main-progress');
  releaseProcess();

  await expect(page.getByText('근무표를 읽었어요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인하고 무료로 확인' })).toBeVisible();

  const html = await page.content();
  const ariaSnapshot = await page.locator('body').ariaSnapshot();

  for (const name of MOCK_NAMES) {
    expect(html, `HTML에 ${name}`).not.toContain(name);
    expect(ariaSnapshot, `접근성 트리에 ${name}`).not.toContain(name);
  }

  isBeforeLogin = false;

  const bodies = await apiBodies.read();

  expect(bodies.some((body) => body.includes('/process'))).toBe(true);

  for (const body of bodies) {
    for (const name of MOCK_NAMES) {
      expect(body, `로그인 전 응답에 ${name}`).not.toContain(name);
    }

    expect(body, '로그인 전 응답에 근무 코드').not.toMatch(SHIFT_CODE_PATTERN);
    expect(body, '로그인 전 응답에 근무 시간').not.toMatch(/\d{2}:\d{2}"/);
  }

  // Demo login returns to the same job (no re-upload) and continues to the name selection.
  await page.getByRole('textbox', { name: /표시 이름/ }).fill(uniqueName('메인'));
  await page.getByRole('button', { name: '로그인하고 무료로 확인' }).click();
  await expect(page).toHaveURL(new RegExp(`/recognitions/${recognitionId}/select$`));
  expect(uploadCount).toBe(1);

  const yearMonth = await page.getByLabel('근무표 대상 월').inputValue();

  expect(yearMonth).toMatch(/^\d{4}-\d{2}$/);
  await page.getByRole('radio', { name: '김하루' }).check();
  await page.getByRole('button', { name: '내 근무 확인하기' }).click();

  // Draft: two review days, save blocked until they are fixed.
  await expect(page).toHaveURL(/\/drafts\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText(`확인 필요한 날짜가 2일 있어요: ${AMBIGUOUS_DAY}일, ${UNREADABLE_DAY}일`),
  ).toBeVisible();

  const saveButton = page.getByRole('button', { name: '확인하고 무료로 저장' });

  await expect(saveButton).toBeDisabled();

  const month = Number(yearMonth.slice(5));
  const dayButton = (day: number) =>
    page
      .getByRole('group', { name: '날짜 선택' })
      .getByRole('button', { name: new RegExp(`^${month}월 ${day}일 `) });
  const codeGroup = page.getByRole('group', { name: '근무 코드 선택' });

  // Day 14 (ambiguous, selected first): confirm with a pointer.
  await expect(dayButton(AMBIGUOUS_DAY)).toHaveAttribute('aria-pressed', 'true');
  await codeGroup.getByRole('button', { name: 'E 이브닝' }).click();
  await expect(dayButton(AMBIGUOUS_DAY)).toHaveAccessibleName(`${month}월 ${AMBIGUOUS_DAY}일 E`);

  // Day 20 (unreadable): keyboard only — focus the grid, arrows, Enter, Tab to the codes, Enter.
  await dayButton(AMBIGUOUS_DAY).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(dayButton(UNREADABLE_DAY)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dayButton(UNREADABLE_DAY)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('원본: 읽지 못함')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(codeGroup.getByRole('button', { name: 'D 데이' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dayButton(UNREADABLE_DAY)).toHaveAccessibleName(`${month}월 ${UNREADABLE_DAY}일 D`);

  await expect(page.getByText('모든 날짜를 확인했어요. 근무 시간도 확인해 주세요.')).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.getByRole('checkbox', { name: /근무 시간을 확인했어요/ }).check();
  await expect(page.getByText('첫 번째 무료 월로 저장돼요')).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  // Calendar: month title and counts.
  await expect(page).toHaveURL(new RegExp(`/calendar/${yearMonth}$`));

  const counts = countWorkAndOff(buildExpectedCodes(yearMonth, 0, DEFAULT_FIXES));

  await expect(page.getByRole('heading', { name: formatYearMonthLabel(yearMonth) })).toBeVisible();
  await expect(page.getByText('김하루님의 근무')).toBeVisible();
  await expect(page.getByText(`근무 ${counts.workCount} · 휴무 ${counts.offCount}`)).toBeVisible();
  await expect(page.getByText('무료로 한 달 더 이용할 수 있어요.')).toBeVisible();
  await saveScreenshot(page, 'main-calendar');
});
