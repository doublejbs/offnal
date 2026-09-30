import { expect } from '@playwright/test';

import {
  createDraftViaApi,
  devLoginViaApi,
  getMockYearMonth,
  uniqueName,
  UNREADABLE_DAY,
} from './support/ApiFlow';
import { getCodeButton, getDayButton } from './support/DraftUi';
import { expectNoHorizontalOverflow, saveScreenshot, test } from './support/OffnalTest';

/** 200% browser zoom on a 390px phone = a 195 CSS px layout viewport at device scale 2. */
test.use({ viewport: { width: 195, height: 422 }, deviceScaleFactor: 2 });

test('200% 확대 상태에서도 초안 날짜 선택·수정 가능', async ({ page }) => {
  const yearMonth = getMockYearMonth();

  await devLoginViaApi(page.request, uniqueName('확대'));

  const { draftId } = await createDraftViaApi(page.request, { yearMonth });

  await page.goto(`/drafts/${draftId}`);

  const day = getDayButton(page, yearMonth, UNREADABLE_DAY);

  await day.scrollIntoViewIfNeeded();
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');

  const nightButton = getCodeButton(page, 'N 나이트');

  await nightButton.scrollIntoViewIfNeeded();
  await nightButton.click();
  await expect(day).toHaveAccessibleName(`${Number(yearMonth.slice(5))}월 ${UNREADABLE_DAY}일 N`);
  await expect(nightButton).toHaveAttribute('aria-pressed', 'true');

  await expectNoHorizontalOverflow(page, 'zoom-draft');
  await saveScreenshot(page, 'zoom-draft');
});
