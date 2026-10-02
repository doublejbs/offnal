import { expect } from '@playwright/test';

import { formatYearMonthLabel } from '@/domain/YearMonth';

import {
  addMonths,
  createDraftViaApi,
  devLoginViaApi,
  getDraftViaApi,
  getMockYearMonth,
  publishMonthViaApi,
  uniqueName,
} from './support/ApiFlow';
import { fixReviewDaysInUi, getCodeButton, getDayButton } from './support/DraftUi';
import { saveScreenshot, test } from './support/OffnalTest';

type CalendarSummary = { months: { yearMonth: string }[]; freeRemaining: number };

test('무료 두 달 → 같은 달 재등록 무료 → 세 번째 달 결제 실패·재시도·성공', async ({ page }) => {
  const monthA = getMockYearMonth();
  const monthB = addMonths(monthA, 1);
  const monthC = addMonths(monthA, 2);
  const readSummary = async (): Promise<CalendarSummary> =>
    (await (await page.request.get('/api/calendar')).json()) as CalendarSummary;

  await devLoginViaApi(page.request, uniqueName('요금'));
  await publishMonthViaApi(page.request, { yearMonth: monthA });

  // Month B through the editor: the second free month.
  const draftB = await createDraftViaApi(page.request, { yearMonth: monthB });

  await page.goto(`/drafts/${draftB.draftId}`);
  await fixReviewDaysInUi(page, monthB);
  await expect(page.getByText('두 번째 무료 월로 저장돼요')).toBeVisible();
  await page.getByRole('button', { name: '확인하고 무료로 저장' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${monthB}$`));
  await expect(page.getByText('새 달은 한 달분 990원 · 자동 결제 없음')).toBeVisible();
  expect((await readSummary()).freeRemaining).toBe(0);

  // Re-publishing month A through 근무 수정 costs nothing.
  await page.goto(`/calendar/${monthA}`);
  await page.getByRole('button', { name: '근무 수정' }).click();
  await expect(page).toHaveURL(/\/drafts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('이미 등록한 달이라 추가 비용 없이 저장돼요')).toBeVisible();
  await getDayButton(page, monthA, 1).click();
  await getCodeButton(page, 'S 상근').click();
  await expect(getDayButton(page, monthA, 1)).toHaveAccessibleName(`${Number(monthA.slice(5))}월 1일 S`);
  await page.getByRole('button', { name: '확인하고 저장' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${monthA}$`));
  await expect(getDayButton(page, monthA, 1)).toHaveAccessibleName(`${Number(monthA.slice(5))}월 1일 S`);
  expect((await readSummary()).freeRemaining).toBe(0);

  // Month C needs a purchase.
  const draftC = await createDraftViaApi(page.request, { yearMonth: monthC });

  await page.goto(`/drafts/${draftC.draftId}`);
  await fixReviewDaysInUi(page, monthC);

  const buyButton = page.getByRole('button', { name: '990원 구매 후 저장' });

  await expect(buyButton).toBeEnabled();
  await expect(page.getByText('무료 두 달을 모두 이용했어요 · 단건 구매, 자동 결제 없음')).toBeVisible();
  await buyButton.click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${monthC}\\?draftId=${draftC.draftId}$`));
  await expect(page.getByText('테스트 결제 · 실제 청구 없음')).toBeVisible();
  await saveScreenshot(page, 'pricing-checkout');

  // Failure: nothing granted, the draft stays.
  await page.getByRole('button', { name: '테스트 결제 실패' }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${monthC}/result\\?`));
  await expect(page.getByRole('heading', { name: '결제가 완료되지 않았어요.' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('MOCK_DECLINED');
  await expect(page.getByText('작성한 근무표는 그대로 있어요.')).toBeVisible();
  await saveScreenshot(page, 'pricing-failed');
  expect((await getDraftViaApi(page.request, draftC.draftId)).draft.yearMonth).toBe(monthC);
  expect((await page.request.get(`/api/calendar/${monthC}`)).status()).toBe(404);
  expect((await readSummary()).months.map((item) => item.yearMonth)).toEqual([monthA, monthB]);

  // Retry → success → saved and shown.
  await page.getByRole('link', { name: '다시 결제하기' }).click();
  await expect(page).toHaveURL(new RegExp(`/checkout/${monthC}\\?draftId=`));
  await page.getByRole('button', { name: '테스트 결제 성공' }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${monthC}$`));
  await expect(page.getByRole('heading', { name: formatYearMonthLabel(monthC) })).toBeVisible();
  expect((await readSummary()).months.map((item) => item.yearMonth)).toEqual([monthA, monthB, monthC]);
});

test('무료 월이 남아 있으면 결제 화면에 결제 버튼 대신 무료 안내', async ({ page }) => {
  const yearMonth = getMockYearMonth();

  await devLoginViaApi(page.request, uniqueName('무료안내'));
  await page.goto(`/checkout/${yearMonth}`);
  await expect(page.getByRole('heading', { name: '이 달은 결제하지 않아도 돼요.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /테스트 결제/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /결제하고 저장/ })).toHaveCount(0);
});
