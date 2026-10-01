import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type Browser, type BrowserContext, expect, type Locator, type Page } from '@playwright/test';

import { MOCK_LEAVE_CODE, MOCK_WORK_CODE_OUTSIDE_LEGEND } from '@/domain/MockFixtureDays';
import { formatYearMonthLabel, listDates } from '@/domain/YearMonth';

import {
  APP_ORIGIN,
  AMBIGUOUS_DAY,
  devLoginViaApi,
  getMockYearMonth,
  publishMonthViaApi,
  UNREADABLE_DAY,
  uniqueName,
  W_END_TIME,
  W_START_TIME,
} from './support/ApiFlow';
import { getCodeButton, getDayButton, getTimeRow } from './support/DraftUi';
import { createPngBuffer } from './support/FixtureImages';
import { expectNoHorizontalOverflow, newIsolatedContext, test } from './support/OffnalTest';

/**
 * Team sharing T1 end to end (docs/TeamShareSpec.md §3·§8) against the demo server: mock vision (10-person
 * fixture for images ≥1600px wide, two 김하루), dev login, one admin and two members in separate contexts.
 * The whole flow runs on a phone (person list) and a wide screen (review table).
 */

const TEAM_IMAGE_SIZE = { width: 1800, height: 1200 };
const TEAM_ROW_COUNT = 10;
const SAME_NAME = '김하루';
/** Mock team fixture rows (r1…r10); 김하루 is r1 and r4. */
const ROSTER_NAMES = ['이여름', '박지우', '최가을', '정겨울', '한바다', '오하늘', '윤소리', '남궁하늘빛나래'];
const MEMBER_A_ROW = `${SAME_NAME} (2)`;
/** r4 (index 3): day 1 OFF, day 2 D, day 3 연차 (Mock pattern, shared undefined-code days). */
const MEMBER_A_FIRST_CODES = `OFF · D · ${MOCK_LEAVE_CODE}`;
const MEMBER_B_ROW = '이여름';
const SCREENSHOT_DIR = path.join('e2e', 'screenshots');
const WIDTHS = [390, 1024];
const mutatingHeaders = { Origin: APP_ORIGIN };

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const saveTeamScreenshot = async (page: Page, screen: string): Promise<void> => {
  const width = page.viewportSize()?.width ?? 0;

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `team-${screen}-${width}.png`), fullPage: true });
};

const monthNumber = (yearMonth: string): number => Number(yearMonth.slice(5));

const dateOf = (yearMonth: string, day: number): string => `${yearMonth}-${String(day).padStart(2, '0')}`;

const getTeamIdFromUrl = (page: Page): string => {
  const match = /\/teams\/([0-9a-f-]{36})/.exec(page.url());

  if (!match?.[1]) {
    throw new Error(`No team id in ${page.url()}`);
  }

  return match[1];
};

const openMemberContext = async (browser: Browser, page: Page): Promise<BrowserContext> => {
  const context = await newIsolatedContext(browser, page);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  return context;
};

const confirmDialog = async (page: Page, label: string): Promise<void> => {
  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
};

/** Demo login form on the page (invite page / AuthRequired), submitted with a display name. */
const loginWithForm = async (page: Page, displayName: string, buttonName: string | RegExp): Promise<void> => {
  const form = page.getByRole('form', { name: '데모 로그인' });

  await form.getByRole('textbox').fill(displayName);
  await form.getByRole('button', { name: buttonName }).click();
};

const isWideLayout = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= 768;

/** Person row button of the phone review list. */
const getPersonButton = (page: Page, name: string): Locator =>
  page
    .getByRole('list', { name: '사람별 확인' })
    .locator('[data-row-button]')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) });

const getGridCell = (page: Page, name: string, yearMonth: string, day: number): Locator =>
  page.getByRole('region', { name: '전체 근무표 확인 표' }).getByRole('button', {
    name: new RegExp(`^${escapeRegExp(name)} ${monthNumber(yearMonth)}월 ${day}일 `),
  });

/** Sets one person's day to a code with the review UI of the current layout (table ≥768px, else person editor). */
const setRosterCell = async (
  page: Page,
  name: string,
  yearMonth: string,
  day: number,
  codeLabel: string,
): Promise<void> => {
  if (isWideLayout(page)) {
    await getGridCell(page, name, yearMonth, day).click();
  } else {
    if ((await page.getByRole('button', { name: '사람 목록으로' }).count()) === 0) {
      await getPersonButton(page, name).click();
    }

    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await getDayButton(page, yearMonth, day).click();
  }

  await getCodeButton(page, codeLabel).click();
};

const backToPersonList = async (page: Page): Promise<void> => {
  if (!isWideLayout(page)) {
    await page.getByRole('button', { name: '사람 목록으로' }).click();
    await expect(page.getByRole('list', { name: '사람별 확인' })).toBeVisible();
  }
};

const listReviewNames = async (page: Page): Promise<string[]> => {
  if (isWideLayout(page)) {
    return page
      .getByRole('region', { name: '전체 근무표 확인 표' })
      .getByRole('rowheader')
      .locator('.block-text')
      .allInnerTexts();
  }

  return page.getByRole('list', { name: '사람별 확인' }).locator('[data-row-button] strong').allInnerTexts();
};

/**
 * Times read from a photo must be confirmed before publishing. Edit drafts of a published roster keep the
 * source cells, so they ask again (the photo itself is already deleted).
 */
const confirmTimesIfAsked = async (page: Page): Promise<void> => {
  const timeCheck = page.getByRole('checkbox', { name: /근무 시간을 확인했어요/ });

  if ((await timeCheck.count()) > 0 && !(await timeCheck.isChecked())) {
    await timeCheck.check();
  }
};

const waitForSaved = async (page: Page): Promise<void> => {
  await confirmTimesIfAsked(page);
  await expect(page.getByText('저장됨').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '팀에 배포하기' })).toBeEnabled();
};

const openTeamPanel = async (page: Page, title: string): Promise<void> => {
  const toggle = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) });

  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
};

const openHistory = async (page: Page): Promise<Locator> => {
  const history = page.locator('details').filter({ hasText: '배포 기록 · 되돌리기' });

  if ((await history.getAttribute('open')) === null) {
    await history.locator('summary').click();
  }

  return history;
};

/**
 * Extraction ends on the review screen. A cold dev server may fail the first extract-next call with something
 * the loop does not retry (e.g. a 404 while the route compiles): then the screen offers "이어서 읽기" — use it.
 */
const waitForReview = async (page: Page): Promise<void> => {
  const review = page.getByRole('heading', { name: /근무표를 확인해 주세요/ });
  const resume = page.getByRole('button', { name: '이어서 읽기' });

  await expect(async () => {
    if (await resume.isVisible()) {
      await resume.click();
    }

    await expect(review).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
};

/** "수정하기" on the current revision (history list: the status card only covers the current month). */
const openEditDraft = async (page: Page, teamId: string): Promise<void> => {
  await page.goto(`/teams/${teamId}`);

  const history = await openHistory(page);

  await history.getByRole('button', { name: '수정하기' }).click();
  await expect(page).toHaveURL(/\/rosters\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /근무표를 확인해 주세요/ })).toBeVisible();
};

const publishAndExpect = async (page: Page, revision: number): Promise<void> => {
  await page.getByRole('button', { name: '팀에 배포하기' }).click();
  await expect(page.getByRole('heading', { name: /근무표를 배포했어요/ })).toBeVisible();
  await expect(page.getByText(`${revision}번째 배포본`)).toBeVisible();
};

const expectNoRosterNames = async (page: Page, allowed: string[] = []): Promise<void> => {
  const html = await page.content();

  for (const name of [SAME_NAME, ...ROSTER_NAMES].filter((item) => !allowed.includes(item))) {
    expect(html, `page must not contain ${name}`).not.toContain(name);
  }
};

const downloadText = async (page: Page, trigger: () => Promise<void>) => {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);

  return {
    fileName: download.suggestedFilename(),
    text: (await readFile(await download.path())).toString('utf8'),
  };
};

test('초대 링크·팀 화면: 무효 링크 안내, 로그인 전 팀 목록은 로그인 안내', async ({ page }) => {
  await page.goto('/join/invalid-token');
  await expect(page.getByRole('heading', { name: '열 수 없는 초대 링크예요' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'join-invalid');

  await page.goto('/teams');
  await expect(page.getByRole('heading', { name: '로그인이 필요해요' })).toBeVisible();
});

for (const width of WIDTHS) {
  test.describe(`팀 공유 T1 · ${width}px`, () => {
    test.use({ viewport: { width, height: width >= 768 ? 900 : 844 } });

    test('관리자 배포 → 초대·승인 → 팀원 달력·공유·ICS → 나가기, 권한·반응형', async ({ page, browser }) => {
      test.setTimeout(600_000);

      const yearMonth = getMockYearMonth();
      const monthLabel = formatYearMonthLabel(yearMonth);
      const teamName = uniqueName('7병동');
      const adminName = uniqueName('관리자');
      const memberAName = uniqueName('팀원A');
      const memberBName = uniqueName('팀원B');
      let teamId = '';
      let inviteUrl = '';

      // ── 1. Admin: team → upload → extraction → review → publish → edit → revert ──
      await test.step('1-a 관리자: 팀 만들기', async () => {
        await devLoginViaApi(page.request, adminName);
        await page.goto('/teams');
        await expect(page.getByRole('heading', { name: '팀이 함께 쓰는 근무 달력' })).toBeVisible();
        await expectNoHorizontalOverflow(page, 'teams-empty');
        await page.getByRole('textbox', { name: '팀 이름' }).fill(teamName);
        await page.getByRole('button', { name: '팀 만들기' }).click();
        await expect(page.getByRole('heading', { name: teamName })).toBeVisible();
        teamId = getTeamIdFromUrl(page);
        await expectNoHorizontalOverflow(page, 'team-admin');
        await saveTeamScreenshot(page, '1a-admin');
      });

      const progressSnapshots: { done: number; total: number; phase: string }[] = [];

      await test.step('1-b 업로드(권한 체크) → 실제 인원 진행률 → 완료', async () => {
        page.on('response', async (response) => {
          if (!response.url().endsWith('/extract-next') || !response.ok()) {
            return;
          }

          const body = (await response.json().catch(() => null)) as {
            progress?: { done: number; manual: number; total: number; phase: string };
          } | null;

          if (body?.progress) {
            progressSnapshots.push({
              done: body.progress.done + body.progress.manual,
              total: body.progress.total,
              phase: body.progress.phase,
            });
          }
        });

        await openTeamPanel(page, '근무표 올리기');
        await page.locator('input[type="file"]').setInputFiles({
          name: 'team-roster.png',
          mimeType: 'image/png',
          buffer: await createPngBuffer(TEAM_IMAGE_SIZE.width, TEAM_IMAGE_SIZE.height),
        });

        const submit = page.getByRole('button', { name: '올리고 팀원 근무 읽기' });

        await expect(submit).toBeDisabled();
        await page.getByRole('checkbox', { name: /이 근무표를 팀에 공유할 권한이 있어요/ }).check();
        await submit.click();
        await expect(page).toHaveURL(/\/teams\/[0-9a-f-]{36}\/rosters\/[0-9a-f-]{36}$/);
        await waitForReview(page);

        // Real counts only: x/10 increasing to 10/10.
        expect(progressSnapshots.length).toBeGreaterThan(0);

        const last = progressSnapshots.at(-1);

        expect(last?.total).toBe(TEAM_ROW_COUNT);
        expect(last?.done).toBe(TEAM_ROW_COUNT);

        for (let index = 1; index < progressSnapshots.length; index += 1) {
          expect(progressSnapshots[index]?.done ?? 0).toBeGreaterThanOrEqual(
            progressSnapshots[index - 1]?.done ?? 0,
          );
        }
      });

      await test.step('1-c 전체 확인: 10명, 김하루 (1)/(2), 처음 보는 코드', async () => {
        await expect(page.getByText(`2 / 2 · 전체 확인 · ${TEAM_ROW_COUNT}명`)).toBeVisible();

        const names = await listReviewNames(page);

        expect(names).toHaveLength(TEAM_ROW_COUNT);
        expect(names).toContain(`${SAME_NAME} (1)`);
        expect(names).toContain(`${SAME_NAME} (2)`);

        for (const name of ROSTER_NAMES) {
          expect(names).toContain(name);
        }

        await expect(page.getByText(`확인이 필요한 칸이 ${TEAM_ROW_COUNT * 4}개 있어요`)).toBeVisible();
        await expect(
          page.getByRole('button', {
            name: new RegExp(`^처음 보는 코드 2개: ${MOCK_LEAVE_CODE}, ${MOCK_WORK_CODE_OUTSIDE_LEGEND}`),
          }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: '팀에 배포하기' })).toBeDisabled();
        await expectNoHorizontalOverflow(page, 'roster-review');
        await saveTeamScreenshot(page, '1c-review');
      });

      if (width >= 768) {
        await test.step('8-a 확인 표 방향키 이동', async () => {
          const first = getGridCell(page, `${SAME_NAME} (1)`, yearMonth, 1);

          await first.focus();
          await page.keyboard.press('ArrowRight');
          await expect(getGridCell(page, `${SAME_NAME} (1)`, yearMonth, 2)).toBeFocused();
          await page.keyboard.press('ArrowDown');
          await expect(getGridCell(page, '이여름', yearMonth, 2)).toBeFocused();
          await page.keyboard.press('ArrowLeft');
          await expect(getGridCell(page, '이여름', yearMonth, 1)).toBeFocused();
          await page.keyboard.press('ArrowUp');
          await expect(first).toBeFocused();
          await page.keyboard.press('End');
          await expect(
            getGridCell(page, `${SAME_NAME} (1)`, yearMonth, listDates(yearMonth).length),
          ).toBeFocused();
        });
      }

      await test.step('1-d 처음 보는 코드: 휴무로 처리 / 시간 입력', async () => {
        await page
          .getByRole('button', {
            name: new RegExp(`^처음 보는 코드 2개: ${MOCK_LEAVE_CODE}, ${MOCK_WORK_CODE_OUTSIDE_LEGEND}`),
          })
          .click();
        await expect(getTimeRow(page, MOCK_LEAVE_CODE)).toBeFocused();
        await getTimeRow(page, MOCK_LEAVE_CODE)
          .getByRole('button', { name: `${MOCK_LEAVE_CODE} 휴무로 처리` })
          .click();

        const wRow = getTimeRow(page, MOCK_WORK_CODE_OUTSIDE_LEGEND);

        await wRow.getByLabel('시작', { exact: true }).fill(W_START_TIME);
        await wRow.getByLabel('종료', { exact: true }).fill(W_END_TIME);
        await expect(page.getByRole('button', { name: /^처음 보는 코드/ })).toHaveCount(0);
        // Defining a code confirms every cell using it (3일 연차, 25일 W in every row).
        await expect(page.getByText(`확인이 필요한 칸이 ${TEAM_ROW_COUNT * 2}개 있어요`)).toBeVisible();
      });

      await test.step('1-e 확인 필요 칸 고치기 → 배포', async () => {
        const rowNames = [`${SAME_NAME} (1)`, `${SAME_NAME} (2)`, ...ROSTER_NAMES];

        for (const name of rowNames) {
          await setRosterCell(page, name, yearMonth, AMBIGUOUS_DAY, 'E 이브닝');
          await setRosterCell(page, name, yearMonth, UNREADABLE_DAY, 'D 데이');
          await backToPersonList(page);
        }

        await expect(
          page.getByText('모든 칸을 확인했어요. 근무 시간을 확인하고 배포해 주세요.'),
        ).toBeVisible();

        await expect(page.getByText('이 달의 첫 배포예요.')).toBeVisible();
        await waitForSaved(page);
        await saveTeamScreenshot(page, '1e-ready');
        await publishAndExpect(page, 1);
        await expectNoHorizontalOverflow(page, 'roster-published');
        await saveTeamScreenshot(page, '1e-published');
      });

      await test.step('1-f 수정하기 → 한 칸 변경 → 미리보기 1칸 → 배포', async () => {
        await openEditDraft(page, teamId);
        await expect(page.getByText('1번째 배포본과 같아요')).toBeVisible();
        await setRosterCell(page, '이여름', yearMonth, 1, 'N 나이트');
        await backToPersonList(page);
        await waitForSaved(page);
        await expect(page.getByText(/^바뀐 칸 1개 · 1명/)).toBeVisible();
        await page.getByText(/^바뀐 칸 1개 · 1명/).click();
        await expect(page.getByText(/^이여름 1칸: 1일 \S+→N$/)).toBeVisible();
        await saveTeamScreenshot(page, '1f-changes-preview');
        await publishAndExpect(page, 2);
        await expect(page.getByText(/바뀐 칸 1개/)).toBeVisible();
      });

      await test.step('1-g 1번째 배포본으로 되돌리기(확인 창)', async () => {
        await page.goto(`/teams/${teamId}`);

        const history = await openHistory(page);

        await history.getByRole('button', { name: `${monthLabel} 1번째 배포본으로 되돌리기` }).click();

        const dialog = page.getByRole('dialog');

        await expect(dialog.getByText('1번째 배포본으로 되돌릴까요?')).toBeVisible();
        await saveTeamScreenshot(page, '1g-revert-dialog');
        await confirmDialog(page, '되돌리기');
        await expect(page.getByText('1번째 배포본으로 되돌려 3번째 배포본을 배포했어요.')).toBeVisible();
        await expect((await openHistory(page)).getByText('3번째 배포본')).toBeVisible();
      });

      // ── 2. Invite link ──
      await test.step('2 초대 링크 만들기·복사', async () => {
        await openTeamPanel(page, '초대 링크');
        await page.getByRole('button', { name: '새 초대 링크 만들기' }).click();

        const field = page.getByRole('textbox', { name: '새 초대 링크' });

        await expect(field).toHaveValue(/\/join\/[\w-]+$/);
        inviteUrl = await field.inputValue();
        await page.getByRole('button', { name: '링크 복사' }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);
        await expectNoHorizontalOverflow(page, 'team-invite');
        await saveTeamScreenshot(page, '2-invite');
      });

      const invitePath = new URL(inviteUrl).pathname;
      const inviteToken = invitePath.split('/join/')[1] ?? '';

      // ── 3. Member A (has a personal month for the same month), member B ──
      const contextA = await openMemberContext(browser, page);
      const pageA = await contextA.newPage();

      await test.step('3-a 팀원A: 같은 달 개인 달력 미리 저장', async () => {
        await devLoginViaApi(pageA.request, memberAName);
        await publishMonthViaApi(pageA.request, { yearMonth });
        await contextA.clearCookies();
      });

      await test.step('3-b 팀원A: 로그아웃 상태 초대 페이지 → 팀 이름만', async () => {
        await pageA.goto(invitePath);
        await expect(pageA.getByRole('heading', { name: teamName })).toBeVisible();
        await expect(pageA.getByRole('heading', { name: '참여하려면 로그인' })).toBeVisible();
        await expectNoRosterNames(pageA);

        const lookup = await contextA.request.get(`/api/invites/${inviteToken}`);

        expect(lookup.ok()).toBe(true);
        expect(Object.keys((await lookup.json()) as object)).toEqual(['teamName']);
        expect((await contextA.request.get(`/api/invites/${inviteToken}/rows`)).status()).toBe(401);
        await expectNoHorizontalOverflow(pageA, 'join-logged-out');
        await saveTeamScreenshot(pageA, '3b-join-logged-out');
      });

      await test.step('3-c 팀원A: 데모 로그인 → 김하루 (2) 선택(순번·첫 3일) → 요청', async () => {
        await loginWithForm(pageA, memberAName, '로그인하고 참여하기');
        await expect(pageA).toHaveURL(new RegExp(`${escapeRegExp(invitePath)}$`));
        await expect(pageA.getByRole('group', { name: '근무표에서 내 이름을 골라 주세요' })).toBeVisible();

        const optionA = pageA.locator('label.person').filter({ hasText: MEMBER_A_ROW });

        await expect(optionA).toContainText(`1~3일 ${MEMBER_A_FIRST_CODES}`);
        await expect(pageA.locator('label.person').filter({ hasText: `${SAME_NAME} (1)` })).toContainText(
          `1~3일 D · D · ${MOCK_LEAVE_CODE}`,
        );
        await expectNoHorizontalOverflow(pageA, 'join-picker');
        await saveTeamScreenshot(pageA, '3c-join-picker');
        await optionA.getByRole('radio').check();
        await pageA.getByRole('button', { name: '참여 요청 보내기' }).click();
        await expect(pageA.getByRole('heading', { name: '관리자가 승인하면 달력에 나타나요' })).toBeVisible();
        await saveTeamScreenshot(pageA, '3c-join-requested');
      });

      const contextB = await openMemberContext(browser, page);
      const pageB = await contextB.newPage();

      await test.step('3-d 팀원B: 이여름 요청', async () => {
        await pageB.goto(invitePath);
        await expectNoRosterNames(pageB);
        await loginWithForm(pageB, memberBName, '로그인하고 참여하기');
        await pageB.locator('label.person').filter({ hasText: MEMBER_B_ROW }).getByRole('radio').check();
        await pageB.getByRole('button', { name: '참여 요청 보내기' }).click();
        await expect(pageB.getByRole('heading', { name: '관리자가 승인하면 달력에 나타나요' })).toBeVisible();
      });

      await test.step('7-a 권한: 승인 대기 팀원은 팀 근무표 404', async () => {
        expect((await pageB.request.get(`/api/teams/${teamId}/roster/${yearMonth}`)).status()).toBe(404);
        expect((await pageB.request.get(`/api/teams/${teamId}`)).status()).toBe(404);
      });

      // ── 4. Admin approves A, rejects B ──
      await test.step('4-a 관리자: A 승인(요청한 행 선택돼 있음), B 거절', async () => {
        await page.goto(`/teams/${teamId}`);
        await expect(page.getByText('참여 요청 2건이 승인을 기다리고 있어요.')).toBeVisible();
        await openTeamPanel(page, '팀원 관리');

        const itemA = page.locator('li.member-item').filter({ hasText: memberAName });
        const itemB = page.locator('li.member-item').filter({ hasText: memberBName });

        await expect(itemA).toContainText(`요청한 이름: ${MEMBER_A_ROW}`);

        const pickerA = itemA.getByRole('combobox', { name: '승인할 근무표 행' });

        await expect(pickerA.locator('option:checked')).toHaveText(
          `${MEMBER_A_ROW} — 1~3일 ${MEMBER_A_FIRST_CODES}`,
        );
        await expectNoHorizontalOverflow(page, 'team-members');
        await saveTeamScreenshot(page, '4a-members');
        await itemA.getByRole('button', { name: '승인' }).click();
        await expect(page.locator('li.member-item').filter({ hasText: memberAName })).toContainText('팀원');
        await itemB.getByRole('button', { name: '거절' }).click();
        await expect(page.locator('li.member-item').filter({ hasText: memberBName })).toHaveCount(0);
        await expect(page.getByText('참여 요청 0건')).toBeVisible();
      });

      await test.step('4-b 팀원B: 거절 후 상태 → 다시 요청 가능', async () => {
        await pageB.goto('/teams');
        await expect(pageB.getByText(teamName)).toHaveCount(0);
        await pageB.goto(`/teams/${teamId}`);
        await expect(pageB.getByRole('heading', { name: '팀을 찾을 수 없어요' })).toBeVisible();
        await pageB.goto(invitePath);
        await expect(pageB.getByRole('heading', { name: teamName })).toBeVisible();
        await saveTeamScreenshot(pageB, '4b-rejected-join');

        // REMOVED people get the picker again (TeamShareSpec §15.2) and re-request through the UI.
        await pageB
          .getByRole('radio', { name: new RegExp(MEMBER_B_ROW) })
          .first()
          .check();
        await pageB.getByRole('button', { name: '참여 요청 보내기' }).click();
        await expect(pageB.getByRole('heading', { name: '관리자가 승인하면 달력에 나타나요' })).toBeVisible();
        await saveTeamScreenshot(pageB, '4b-rerequest');
      });

      // ── 5. Member A: calendar, team page, full roster, changes, share, ICS ──
      await test.step('5-a 팀원A: 달력에 팀 달(팀 이름, 읽기 전용, 개인본 보관)', async () => {
        await pageA.goto(`/calendar/${yearMonth}`);
        await expect(pageA.getByText(`${teamName} 근무표`, { exact: true })).toBeVisible();
        await expect(pageA.getByText('팀 관리자가 배포한 근무예요')).toBeVisible();
        await expect(
          pageA.getByText('이 달에 직접 저장했던 개인 달력은 지우지 않고 보관하고 있어요.'),
        ).toBeVisible();
        await expect(pageA.getByRole('button', { name: '근무 수정' })).toHaveCount(0);
        await expect(pageA.getByRole('button', { name: '이 달 달력 삭제' })).toHaveCount(0);
        await expect(pageA.getByRole('button', { name: '확인했어요' })).toHaveCount(0);
        await expect(getDayButton(pageA, yearMonth, 1)).toHaveAccessibleName(/OFF|휴무/);
        await expectNoHorizontalOverflow(pageA, 'member-calendar');
        await saveTeamScreenshot(pageA, '5a-member-calendar');

        // Read-only on the server too.
        const deleteResponse = await pageA.request.delete(`/api/calendar/${yearMonth}`, {
          headers: mutatingHeaders,
        });

        expect(deleteResponse.status()).toBe(409);
      });

      await test.step('5-b 팀원A: 팀 화면(팀원) → 전체 근무표', async () => {
        await pageA.goto(`/teams/${teamId}`);
        await expect(pageA.getByRole('heading', { name: teamName })).toBeVisible();
        await expect(pageA.getByText('팀원', { exact: true })).toBeVisible();
        await expect(pageA.getByRole('button', { name: /근무표 올리기/ })).toHaveCount(0);
        await expectNoHorizontalOverflow(pageA, 'member-team');
        await saveTeamScreenshot(pageA, '5b-member-team');
        await pageA.getByRole('link', { name: `${monthLabel} 전체 근무표 보기` }).click();
        await expect(pageA.getByRole('heading', { name: monthLabel })).toBeVisible();

        const table = pageA.getByRole('region', { name: '전체 근무표' });

        await expect(table.locator('tbody tr[data-mine="true"]')).toHaveCount(1);
        await expect(table.locator('tbody tr[data-mine="true"]')).toContainText(MEMBER_A_ROW);
        await expect(table.locator('tbody tr').filter({ hasText: '남궁하늘빛나래' })).toHaveCount(1);
        await expectNoHorizontalOverflow(pageA, 'roster-read');
        await saveTeamScreenshot(pageA, '5b-roster-read');
      });

      await test.step('7-b 권한: 팀원이 관리자 API → 404', async () => {
        expect((await pageA.request.get(`/api/teams/${teamId}/rosters`)).status()).toBe(404);
        expect((await pageA.request.get(`/api/teams/${teamId}/members`)).status()).toBe(404);
        expect((await pageA.request.get(`/api/teams/${teamId}/invites`)).status()).toBe(404);

        const patch = await pageA.request.patch(`/api/teams/${teamId}`, {
          headers: mutatingHeaders,
          data: { shareRosterWithMembers: false },
        });

        expect(patch.status()).toBe(404);
      });

      await test.step('5-c 관리자: 전체 근무표 공개 끄기 → 팀원 안내', async () => {
        await page.goto(`/teams/${teamId}`);
        await openTeamPanel(page, '팀 설정');

        // Controlled by the saved setting: it flips once the PATCH answers.
        const shareToggle = page.getByRole('checkbox', { name: /팀원끼리 전체 근무표 보기/ });

        await expect(shareToggle).toBeChecked();
        await shareToggle.click();
        await expect(page.getByText('이제 팀원은 자기 근무만 볼 수 있어요.')).toBeVisible();
        await expect(shareToggle).not.toBeChecked();
        await pageA.goto(`/teams/${teamId}`);
        await expect(
          pageA.getByText('관리자가 전체 근무표 공개를 꺼 두었어요. 내 근무만 볼 수 있어요.'),
        ).toBeVisible();
        await expect(pageA.getByRole('link', { name: /전체 근무표 보기/ })).toHaveCount(0);
        await pageA.goto(`/teams/${teamId}/roster/${yearMonth}`);
        await expect(pageA.getByRole('heading', { name: '전체 근무표가 비공개예요' })).toBeVisible();
        await expectNoRosterNames(pageA, [SAME_NAME]);
        await saveTeamScreenshot(pageA, '5c-roster-off');
        // Turn it back on for the rest of the flow.
        await shareToggle.click();
        await expect(page.getByText('팀원도 전체 근무표를 볼 수 있어요.')).toBeVisible();
        await expect(shareToggle).toBeChecked();
      });

      await test.step('5-d 관리자: A 행 제외 → 배포 시 연결 경고 → 취소 → A 행 변경 배포', async () => {
        await openEditDraft(page, teamId);

        if (isWideLayout(page)) {
          await getGridCell(page, MEMBER_A_ROW, yearMonth, 1).click();
        } else {
          await getPersonButton(page, MEMBER_A_ROW).click();
        }

        await page.getByRole('button', { name: '이 행 제외' }).click();
        await backToPersonList(page);
        await waitForSaved(page);
        await page.getByRole('button', { name: '팀에 배포하기' }).click();

        const dialog = page.getByRole('dialog');

        await expect(dialog.getByText('연결된 팀원의 행이 없어요')).toBeVisible();
        await expect(dialog).toContainText(SAME_NAME);
        await saveTeamScreenshot(page, '5d-unlinked-dialog');
        await dialog.getByRole('button', { name: '취소' }).click();
        await expect(dialog).toBeHidden();

        if (isWideLayout(page)) {
          await getGridCell(page, MEMBER_A_ROW, yearMonth, 1).click();
        } else {
          await getPersonButton(page, MEMBER_A_ROW).click();
        }

        await page.getByRole('button', { name: '다시 포함' }).click();
        await backToPersonList(page);
        await setRosterCell(page, MEMBER_A_ROW, yearMonth, 1, 'D 데이');
        await backToPersonList(page);
        await waitForSaved(page);
        await expect(page.getByText(/^바뀐 칸 1개 · 1명/)).toBeVisible();
        await publishAndExpect(page, 4);
      });

      await test.step('5-e 팀원A: 변경 배지·ICS 안내 → 확인했어요 → 배지 사라짐', async () => {
        await pageA.goto(`/calendar/${yearMonth}`);
        await expect(pageA.getByText('근무가 바뀌었어요')).toBeVisible();
        await expect(pageA.getByText('근무가 바뀐 날 1일: 1일')).toBeVisible();
        await expect(pageA.getByText(/캘린더 앱에 이미 추가한 일정은 자동으로 바뀌지 않아요/)).toBeVisible();
        await expect(getDayButton(pageA, yearMonth, 1)).toHaveAccessibleName(/변경됨$/);
        await expect(getDayButton(pageA, yearMonth, 1).getByText('변경')).toBeVisible();
        await saveTeamScreenshot(pageA, '5e-changed');
        await pageA.getByRole('button', { name: '확인했어요' }).click();
        await expect(pageA.getByText('근무가 바뀌었어요')).toHaveCount(0);
        await expect(getDayButton(pageA, yearMonth, 1)).not.toHaveAccessibleName(/변경됨$/);
        await pageA.reload();
        await expect(pageA.getByText(`${teamName} 근무표`, { exact: true })).toBeVisible();
        await expect(pageA.getByText('근무가 바뀌었어요')).toHaveCount(0);
      });

      let shareUrl = '';

      await test.step('5-f 팀원A: 공유 링크에 팀 달 공개 → 새 컨텍스트에서 A 근무만', async () => {
        await pageA.goto(`/calendar/${yearMonth}/share`);
        await pageA.getByRole('button', { name: /링크로 공유/ }).click();

        const monthCheckbox = pageA.getByRole('checkbox', { name: new RegExp(`^${monthLabel}`) });

        await expect(pageA.locator('label.check').filter({ hasText: monthLabel })).toContainText('팀 근무표');
        await monthCheckbox.check();
        await pageA.getByRole('button', { name: '공유 링크 만들기' }).click();

        const linkField = pageA.getByRole('textbox', { name: '공유 링크' });

        await expect(linkField).toHaveValue(/\/s\/[A-Za-z0-9_-]+$/);
        shareUrl = await linkField.inputValue();
        await expectNoHorizontalOverflow(pageA, 'member-share');
        await saveTeamScreenshot(pageA, '5f-share');

        const guestContext = await newIsolatedContext(browser, page);
        const guest = await guestContext.newPage();

        await guest.goto(shareUrl);
        await expect(guest.getByRole('heading', { name: monthLabel })).toBeVisible();
        await expect(getDayButton(guest, yearMonth, 1)).toHaveAccessibleName(/D|데이/);
        await expect(getDayButton(guest, yearMonth, 2)).toHaveAccessibleName(/D|데이/);
        await expectNoRosterNames(guest, [SAME_NAME]);
        await saveTeamScreenshot(guest, '5f-shared-view');
        await guestContext.close();
      });

      await test.step('5-g 팀원A: 팀 달 ICS 받기(이용권 없이)', async () => {
        await pageA.goto(`/calendar/${yearMonth}/share`);
        await pageA.getByRole('button', { name: /내 캘린더에 추가/ }).click();

        const ics = await downloadText(pageA, () =>
          pageA.getByRole('button', { name: '일정 파일 받기' }).click(),
        );

        expect(ics.fileName).toBe(`offnal-${yearMonth}.ics`);
        expect(ics.text).toContain('BEGIN:VCALENDAR');
        expect(ics.text).toContain('BEGIN:VEVENT');
        // Day 1 became D in the 4th revision: it is exported as a work event.
        expect(ics.text).toContain(dateOf(yearMonth, 1).replaceAll('-', ''));
      });

      // ── 6. Member A leaves ──
      await test.step('6 팀원A: 팀 나가기 → 팀 달 사라지고 개인 달 다시 보임, 공유 링크에서 빠짐', async () => {
        await pageA.goto(`/teams/${teamId}`);
        await pageA.getByRole('button', { name: '팀 나가기' }).click();
        await confirmDialog(pageA, '나가기');
        await expect(pageA).toHaveURL(/\/teams$/);
        await pageA.goto(`/calendar/${yearMonth}`);
        await expect(pageA.getByText('내 달력', { exact: true })).toBeVisible();
        await expect(pageA.getByText(`${teamName} 근무표`)).toHaveCount(0);
        await expect(pageA.getByRole('button', { name: '근무 수정' })).toBeVisible();
        await saveTeamScreenshot(pageA, '6-after-leave');

        const guestContext = await newIsolatedContext(browser, page);
        const guest = await guestContext.newPage();

        const sharedApi = await guestContext.request.get(`/api/shared/${shareUrl.split('/s/')[1] ?? ''}`);

        expect(((await sharedApi.json()) as { months: string[] }).months).toEqual([]);
        await guest.goto(shareUrl);
        // The team month was the only month on the link (the personal one stays unshared).
        await expect(guest.getByRole('heading', { name: '아직 공개된 달이 없어요' })).toBeVisible();
        await saveTeamScreenshot(guest, '6-shared-after-leave');
        await expect(guest.getByRole('heading', { name: monthLabel })).toHaveCount(0);
        await guestContext.close();
        expect((await pageA.request.get(`/api/teams/${teamId}/my-months`)).status()).toBe(404);
      });

      // ── 7. Logged-out team page ──
      await test.step('7-c 로그아웃 상태 /teams/:id → 로그인 안내', async () => {
        const anonymous = await newIsolatedContext(browser, page);
        const anonymousPage = await anonymous.newPage();

        await anonymousPage.goto(`/teams/${teamId}`);
        await expect(anonymousPage.getByRole('heading', { name: '로그인이 필요해요' })).toBeVisible();
        await expectNoRosterNames(anonymousPage);
        expect((await anonymous.request.get(`/api/teams/${teamId}`)).status()).toBe(401);
        await anonymousPage.goto(`/teams/${teamId}/roster/${yearMonth}`);
        await expect(anonymousPage.getByRole('heading', { name: '로그인이 필요해요' })).toBeVisible();
        await saveTeamScreenshot(anonymousPage, '7c-logged-out');
        await anonymous.close();
      });

      // ── 8. Responsive: admin full roster view, team list ──
      await test.step('8-b 관리자 전체 근무표·팀 목록 가로 넘침 없음', async () => {
        await page.goto(`/teams/${teamId}/roster/${yearMonth}`);
        await expect(page.getByRole('heading', { name: monthLabel })).toBeVisible();
        await expectNoHorizontalOverflow(page, 'admin-roster-read');
        await page.goto('/teams');
        await expect(page.getByRole('heading', { name: '내 팀' })).toBeVisible();
        await expectNoHorizontalOverflow(page, 'teams-list');
        await saveTeamScreenshot(page, '8-teams-list');
      });

      await contextA.close();
      await contextB.close();
    });
  });
}
