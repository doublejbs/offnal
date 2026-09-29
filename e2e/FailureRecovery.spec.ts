import { expect } from '@playwright/test';

import {
  createDraftViaApi,
  devLoginViaApi,
  getMockYearMonth,
  MOCK_NAMES,
  uniqueName,
  uploadViaApi,
} from './support/ApiFlow';
import { NARROW_IMAGE_SIZE, TABLE_IMAGE_SIZE, writePngFixture } from './support/FixtureImages';
import { newIsolatedContext, saveScreenshot, test } from './support/OffnalTest';

const GATE_HEADLINE = '근무표를 읽었어요.';

test('좁은 사진 → 인식 실패 안내와 재시도, 블러 화면 없음', async ({ page }, testInfo) => {
  const fixture = await writePngFixture(testInfo, 'narrow-250x900.png', NARROW_IMAGE_SIZE);

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page).toHaveURL(/\/recognitions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: '근무표를 읽지 못했어요' })).toBeVisible();
  await expect(
    page.getByText('사진에서 근무표를 찾지 못했어요. 표 전체가 보이게 다시 찍어 주세요.'),
  ).toBeVisible();
  await expect(page.getByText(GATE_HEADLINE)).toHaveCount(0);
  await expect(page.getByRole('link', { name: '다른 사진 올리기' })).toBeVisible();
  await saveScreenshot(page, 'recognition-failed');

  // Retry runs recognition again on the same photo (still a failure with this image).
  const processCall = page.waitForResponse(
    (response) => response.url().endsWith('/process') && response.request().method() === 'POST',
  );

  await page.getByRole('button', { name: '다시 시도' }).click();
  expect((await processCall).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '근무표를 읽지 못했어요' })).toBeVisible();
  await expect(page.getByText(GATE_HEADLINE)).toHaveCount(0);
});

test('로그인 취소(?login=failed) → 안내, 같은 작업의 블러 화면 유지', async ({ page }, testInfo) => {
  const fixture = await writePngFixture(testInfo, 'schedule-1200x900.png', TABLE_IMAGE_SIZE);
  let uploadCount = 0;

  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/recognitions') {
      uploadCount += 1;
    }
  });

  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByText(GATE_HEADLINE)).toBeVisible();

  const recognitionPath = new URL(page.url()).pathname;

  await page.goto(`${recognitionPath}?login=failed`);
  await expect(
    page.getByText('로그인이 완료되지 않았어요. 사진은 그대로 있으니 다시 시도해 주세요.'),
  ).toBeVisible();
  await expect(page.getByText(GATE_HEADLINE)).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인하고 무료로 확인' })).toBeVisible();
  await saveScreenshot(page, 'gate-login-failed');
  expect(uploadCount).toBe(1);

  // Logging in afterwards still continues the same job.
  await page.getByRole('textbox', { name: /표시 이름/ }).fill(uniqueName('재시도'));
  await page.getByRole('button', { name: '로그인하고 무료로 확인' }).click();
  await expect(page).toHaveURL(new RegExp(`${recognitionPath}/select$`));
  await expect(page.getByRole('radio', { name: '김하루' })).toBeVisible();
  expect(uploadCount).toBe(1);
});

test('다른 세션·계정의 작업 ID와 초안 ID로는 접근할 수 없음', async ({ page, browser }) => {
  // Owner A: an anonymous job, and a logged-in draft.
  const anonymousJobId = await uploadViaApi(page.request);

  await devLoginViaApi(page.request, uniqueName('소유자'));

  const owned = await createDraftViaApi(page.request, { yearMonth: getMockYearMonth() });

  // Visitor B (anonymous, then logged in as someone else).
  const otherContext = await newIsolatedContext(browser, page);
  const other = await otherContext.newPage();

  await other.goto(`/recognitions/${anonymousJobId}`);
  await expect(other.getByRole('heading', { name: '작업을 찾을 수 없어요' })).toBeVisible();
  expect((await otherContext.request.get(`/api/recognitions/${anonymousJobId}/status`)).status()).toBe(404);

  await devLoginViaApi(otherContext.request, uniqueName('타인'));
  expect(
    (await otherContext.request.get(`/api/recognitions/${owned.recognitionId}/candidates`)).status(),
  ).toBe(404);
  expect((await otherContext.request.get(`/api/recognitions/${owned.recognitionId}/source`)).status()).toBe(
    404,
  );
  expect((await otherContext.request.get(`/api/drafts/${owned.draftId}`)).status()).toBe(404);

  await other.goto(`/drafts/${owned.draftId}`);
  await expect(other.getByRole('heading', { name: '초안을 불러오지 못했어요' })).toBeVisible();
  await other.goto(`/recognitions/${owned.recognitionId}/select`);
  await expect(other.getByRole('heading', { name: '근무표를 불러오지 못했어요' })).toBeVisible();

  const html = await other.content();

  for (const name of MOCK_NAMES) {
    expect(html).not.toContain(name);
  }

  await otherContext.close();
});
