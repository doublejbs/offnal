import { expect, type Locator, type Page } from '@playwright/test';

import { MOCK_LEAVE_CODE, MOCK_WORK_CODE_OUTSIDE_LEGEND } from '@/domain/MockFixtureDays';

import { AMBIGUOUS_DAY, UNREADABLE_DAY, W_END_TIME, W_START_TIME } from './ApiFlow';

export const getDayButton = (page: Page, yearMonth: string, day: number): Locator => {
  const month = Number(yearMonth.slice(5));

  return page
    .getByRole('group', { name: '날짜 선택' })
    .getByRole('button', { name: new RegExp(`^${month}월 ${day}일 `) });
};

export const getCodeButton = (page: Page, accessibleName: string): Locator =>
  page
    .getByRole('group', { name: '근무 코드 선택' })
    .getByRole('button', { name: accessibleName, exact: true });

export const getTimeRow = (page: Page, code: string): Locator =>
  page.getByRole('region', { name: '근무 시간' }).getByRole('group', { name: `${code} 근무 시간` });

/**
 * Spec §16: the warning jumps to the first code outside the legend; 연차 becomes a day off with the quick
 * button, W gets times. Every date using them is then confirmed at once.
 */
export const defineUndefinedCodesInUi = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /^처음 보는 코드 2개: 연차, W/ }).click();
  await expect(getTimeRow(page, MOCK_LEAVE_CODE)).toBeFocused();
  await getTimeRow(page, MOCK_LEAVE_CODE)
    .getByRole('button', { name: `${MOCK_LEAVE_CODE} 휴무로 처리` })
    .click();

  const wRow = getTimeRow(page, MOCK_WORK_CODE_OUTSIDE_LEGEND);

  await wRow.getByLabel('시작').fill(W_START_TIME);
  await wRow.getByLabel('종료').fill(W_END_TIME);
  await expect(page.getByRole('button', { name: /^처음 보는 코드/ })).toHaveCount(0);
};

/** Fixes the review days of a recognized draft with the pointer and confirms the times. */
export const fixReviewDaysInUi = async (page: Page, yearMonth: string): Promise<void> => {
  await defineUndefinedCodesInUi(page);
  await getDayButton(page, yearMonth, AMBIGUOUS_DAY).click();
  await getCodeButton(page, 'E 이브닝').click();
  await getDayButton(page, yearMonth, UNREADABLE_DAY).click();
  await getCodeButton(page, 'D 데이').click();
  await expect(page.getByText('모든 날짜를 확인했어요. 근무 시간도 확인해 주세요.')).toBeVisible();
  await page.getByRole('checkbox', { name: /근무 시간을 확인했어요/ }).check();
};
