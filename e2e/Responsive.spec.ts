import { expect } from '@playwright/test';

import { formatYearMonthLabel } from '@/domain/YearMonth';

import {
  addMonths,
  AMBIGUOUS_DAY,
  devLoginViaApi,
  enableShareViaApi,
  getMockYearMonth,
  publishMonthViaApi,
  uniqueName,
  UNREADABLE_DAY,
  uploadViaApi,
} from './support/ApiFlow';
import { defineUndefinedCodesInUi, getCodeButton, getDayButton } from './support/DraftUi';
import { expectNoHorizontalOverflow, newIsolatedContext, saveScreenshot, test } from './support/OffnalTest';

const LONG_NAME = '남궁하늘빛나래';
const LONG_CODE = '연차휴가';

test('주요 화면 가로 넘침 없음 (긴 이름·사용자 코드 포함)', async ({ page, browser }) => {
  const check = async (screen: string) => {
    await expectNoHorizontalOverflow(page, screen);
    await saveScreenshot(page, screen);
  };
  const yearMonth = getMockYearMonth();

  // Upload
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /근무표 한 장이면/ })).toBeVisible();
  await check('upload');

  // Blur gate (anonymous)
  const recognitionId = await uploadViaApi(page.request);

  await page.goto(`/recognitions/${recognitionId}`);
  await expect(page.getByText('근무표를 읽었어요.')).toBeVisible();
  await check('gate');

  // Name selection (long name wraps)
  await devLoginViaApi(page.request, uniqueName(LONG_NAME));
  await page.goto(`/recognitions/${recognitionId}`);
  await expect(page).toHaveURL(new RegExp(`/recognitions/${recognitionId}/select$`));
  await expect(page.getByRole('radio', { name: LONG_NAME })).toBeVisible();
  await check('select');

  // Draft with a custom long code added in the time editor and used on a day
  await page.getByRole('radio', { name: LONG_NAME }).check();
  await page.getByRole('button', { name: '내 근무 확인하기' }).click();
  await expect(page).toHaveURL(/\/drafts\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`${LONG_NAME} · ${formatYearMonthLabel(yearMonth)}`)).toBeVisible();

  const timeSection = page.getByRole('region', { name: '근무 시간' });

  await timeSection.getByText('근무 시간 확인 · 코드 관리').click();

  const addForm = timeSection.getByRole('form', { name: '근무 코드 추가' });

  await addForm.getByRole('textbox', { name: '코드' }).fill(LONG_CODE);
  await addForm.getByRole('textbox', { name: '이름' }).fill(LONG_CODE);
  await addForm.getByRole('button', { name: '코드 추가' }).click();

  const longCodeRow = timeSection.getByRole('group', { name: `${LONG_CODE} 근무 시간` });

  await expect(longCodeRow).toBeVisible();
  await longCodeRow.getByRole('checkbox', { name: '휴무 (근무 시간 없음)' }).check();

  await getDayButton(page, yearMonth, AMBIGUOUS_DAY).click();
  await getCodeButton(page, 'E 이브닝').click();
  await getDayButton(page, yearMonth, UNREADABLE_DAY).click();
  await getCodeButton(page, `${LONG_CODE} ${LONG_CODE}`).click();
  await expect(getDayButton(page, yearMonth, UNREADABLE_DAY)).toHaveAccessibleName(
    `${Number(yearMonth.slice(5))}월 ${UNREADABLE_DAY}일 ${LONG_CODE}`,
  );
  await expect(page.getByRole('button', { name: /^처음 보는 코드 2개/ })).toBeVisible();
  await check('draft-undefined-codes');
  await defineUndefinedCodesInUi(page);
  await page.getByRole('checkbox', { name: /근무 시간을 확인했어요/ }).check();
  await check('draft');

  // Calendar
  await page.getByRole('button', { name: '확인하고 무료로 저장' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${yearMonth}$`));
  await expect(page.getByText(`${LONG_NAME}님의 근무`)).toBeVisible();
  await check('calendar');

  // Share settings with an active link
  const shareUrl = await enableShareViaApi(page.request, {
    displayName: LONG_NAME,
    visibleMonths: [yearMonth],
  });

  await page.goto(`/calendar/${yearMonth}/share`);
  await page.getByRole('button', { name: /링크로 공유/ }).click();
  await expect(page.getByRole('textbox', { name: '공유 링크' })).toHaveValue(shareUrl);
  await check('share');

  // Shared view (no cookies)
  const guestContext = await newIsolatedContext(browser, page);
  const guest = await guestContext.newPage();

  await guest.goto(shareUrl);
  await expect(guest.getByText(`${LONG_NAME}님의 근무`)).toBeVisible();
  await expectNoHorizontalOverflow(guest, 'shared');
  await saveScreenshot(guest, 'shared');
  await guestContext.close();

  // Checkout for a third month (two free months used)
  await publishMonthViaApi(page.request, { yearMonth: addMonths(yearMonth, 1) });
  await page.goto(`/checkout/${addMonths(yearMonth, 2)}`);
  await expect(page.getByRole('button', { name: '테스트 결제 성공' })).toBeVisible();
  await check('checkout');
});
