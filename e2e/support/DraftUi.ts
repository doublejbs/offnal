import { expect, type Locator, type Page } from '@playwright/test';

import { AMBIGUOUS_DAY, UNREADABLE_DAY } from './ApiFlow';

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

/** Fixes the two review days of a recognized draft with the pointer and confirms the times. */
export const fixReviewDaysInUi = async (page: Page, yearMonth: string): Promise<void> => {
  await getDayButton(page, yearMonth, AMBIGUOUS_DAY).click();
  await getCodeButton(page, 'E 이브닝').click();
  await getDayButton(page, yearMonth, UNREADABLE_DAY).click();
  await getCodeButton(page, 'D 데이').click();
  await expect(page.getByText('모든 날짜를 확인했어요. 근무 시간도 확인해 주세요.')).toBeVisible();
  await page.getByRole('checkbox', { name: /근무 시간을 확인했어요/ }).check();
};
