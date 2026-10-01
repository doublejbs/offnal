import { expect } from '@playwright/test';

import { devLoginViaApi, MOCK_NAMES, uniqueName } from './support/ApiFlow';
import { createPngBuffer, TABLE_IMAGE_SIZE } from './support/FixtureImages';
import { expectNoHorizontalOverflow, newIsolatedContext, saveScreenshot, test } from './support/OffnalTest';

/** Team sharing T1 screens (docs/TeamShareSpec.md §8) against the demo server (mock vision, dev login). */

test('초대 링크·팀 화면: 로그인 전에는 팀 이름만, 무효 링크는 안내', async ({ page }) => {
  await page.goto('/join/invalid-token');
  await expect(page.getByRole('heading', { name: '열 수 없는 초대 링크예요' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'join-invalid');

  await page.goto('/teams');
  await expect(page.getByRole('heading', { name: '로그인이 필요해요' })).toBeVisible();
  await expect(page.getByText('팀 공유는 관리자가 근무표를 한 번 올리면')).toBeVisible();
});

test('관리자: 팀 만들기 → 초대 링크 → 근무표 올리기 → 전원 추출 → 확인 → 배포', async ({ page, browser }) => {
  const teamName = uniqueName('7병동');

  await devLoginViaApi(page.request, uniqueName('관리자'));
  await page.goto('/teams');
  await expect(page.getByRole('heading', { name: '팀이 함께 쓰는 근무 달력' })).toBeVisible();
  await page.getByRole('textbox', { name: '팀 이름' }).fill(teamName);
  await page.getByRole('button', { name: '팀 만들기' }).click();
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'team-admin');
  await saveScreenshot(page, 'team-admin');

  // Invite link: shown once, right after creating it.
  await page.getByRole('button', { name: /초대 링크/ }).click();
  await page.getByRole('button', { name: '새 초대 링크 만들기' }).click();

  const inviteUrl = await page.getByRole('textbox', { name: '새 초대 링크' }).inputValue();

  expect(inviteUrl).toMatch(/\/join\/[\w-]+$/);

  // Before login the invite page shows the team name only.
  const anonymous = await newIsolatedContext(browser, page);
  const anonymousPage = await anonymous.newPage();

  await anonymousPage.goto(new URL(inviteUrl).pathname);
  await expect(anonymousPage.getByRole('heading', { name: teamName })).toBeVisible();
  await expect(anonymousPage.getByRole('heading', { name: '참여하려면 로그인' })).toBeVisible();
  await expect(anonymousPage.getByText(MOCK_NAMES[0]!)).toHaveCount(0);
  await anonymous.close();

  // Upload: the consent checkbox is required.
  await page.getByRole('button', { name: /근무표 올리기/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'roster.png',
    mimeType: 'image/png',
    buffer: await createPngBuffer(TABLE_IMAGE_SIZE.width, TABLE_IMAGE_SIZE.height),
  });

  const submit = page.getByRole('button', { name: '올리고 팀원 근무 읽기' });

  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /이 근무표를 팀에 공유할 권한이 있어요/ }).check();
  await submit.click();
  await expect(page).toHaveURL(/\/teams\/[0-9a-f-]{36}\/rosters\/[0-9a-f-]{36}$/);

  // Extraction runs by itself, then the review (person list on phones, table from 768px).
  await expect(page.getByRole('heading', { name: /근무표를 확인해 주세요/ })).toBeVisible({
    timeout: 60_000,
  });
  await expectNoHorizontalOverflow(page, 'roster-review');
  await saveScreenshot(page, 'roster-review');
  await expect(page.getByRole('button', { name: '팀에 배포하기' })).toBeVisible();
});
