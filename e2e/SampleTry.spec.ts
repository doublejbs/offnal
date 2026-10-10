import { expect, type Page, type Request } from '@playwright/test';

import { SAMPLE_ROSTER } from '@/client/SampleTryData';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';

import { devLoginViaApi, uniqueName } from './support/ApiFlow';
import { getCodeButton, getDayButton } from './support/DraftUi';
import { expectNoHorizontalOverflow, saveScreenshot, test } from './support/OffnalTest';

const YEAR_MONTH = '2026-11';
const EVENTS_PATH = '/api/events';
/** Static files and dev-server internals the page may load; anything else during the trial is a failure. */
const ALLOWED_PREFIXES = ['/_next/', '/sample/', '/__nextjs', '/favicon.ico', '/icon.png', '/apple-icon.png'];

const pathOf = (request: Request): string => new URL(request.url()).pathname;

const eventOf = (request: Request): string | null => {
  if (pathOf(request) !== EVENTS_PATH) {
    return null;
  }

  try {
    return (JSON.parse(request.postData() ?? '{}') as { event?: string }).event ?? null;
  } catch {
    return null;
  }
};

/**
 * Playwright does not expose a beacon's body, so the page takes the helper's other transport (keepalive fetch)
 * by having `sendBeacon` decline.
 */
const declineBeacons = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    Navigator.prototype.sendBeacon = () => false;
  });
};

/** Every request the page makes while `isActive()`, and the usage events among them. */
const watchRequests = (page: Page, isActive: () => boolean) => {
  const paths: string[] = [];
  const events: string[] = [];

  page.on('request', (request) => {
    if (!isActive()) {
      return;
    }

    paths.push(`${request.method()} ${pathOf(request)}${new URL(request.url()).search}`);

    const event = eventOf(request);

    if (event) {
      events.push(event);
    }
  });

  return { paths, events };
};

const countOf = (events: string[], event: AnalyticsEvent): number =>
  events.filter((item) => item === event).length;

test('예시 체험: 근무표 읽기 → 이름 고르기 → 확인 필요 칸 고치기 → 완성 → 내 근무표로 만들기', async ({
  page,
}) => {
  const person = SAMPLE_ROSTER.find((item) => item.rowId === 's2');

  expect(person).toBeDefined();

  if (!person) {
    return;
  }

  await declineBeacons(page);

  let isOnTrial = false;
  const watched = watchRequests(page, () => isOnTrial);

  await page.goto('/');
  // "사진 선택" stays the first-viewport primary action; the trial is the secondary one below the box.
  await expect(page.locator('label.primary', { hasText: '사진 선택' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('link', { name: '예시 근무표로 먼저 해 보기' })).toBeVisible();
  isOnTrial = true;
  await page.getByRole('link', { name: '예시 근무표로 먼저 해 보기' }).click();
  await expect(page).toHaveURL(/\/try$/);

  // Step 1: the photo was "read".
  await expect(page.getByRole('note').filter({ hasText: '예시 체험' })).toHaveText(
    '예시 체험 · 실제 저장되지 않아요',
  );
  await expect(page.getByRole('heading', { name: '근무표를 읽었어요.' })).toBeVisible();
  await expect(page.getByRole('img', { name: /예시 병동 근무표 사진/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'try-read');
  await saveScreenshot(page, 'try-read');

  // The click-through to /try came from a client navigation; only the trial page's own requests count from here.
  watched.paths.length = 0;

  await page.getByRole('button', { name: '내 이름 고르기' }).click();

  // Step 2: pick a name (the default is preselected).
  await expect(page.getByRole('heading', { name: '어느 분의 근무표인가요?' })).toBeFocused();
  await expect(page.getByRole('radio', { name: SAMPLE_ROSTER[0]?.name })).toBeChecked();
  await page.getByRole('radio', { name: person.name }).check();
  await saveScreenshot(page, 'try-choose');
  await page.getByRole('button', { name: '내 근무 확인하기' }).click();

  // Step 3: one cell needs checking; finishing is blocked until it is fixed.
  await expect(page.getByRole('heading', { name: /내 근무가 맞는지/ })).toBeVisible();
  await expect(page.getByText(`${person.name} · 2026년 11월 · 날짜를 눌러 수정`)).toBeVisible();
  await expect(page.getByText(`확인 필요한 날짜가 1일 있어요: ${person.reviewDay}일`)).toBeVisible();
  await expect(page.getByRole('button', { name: '확인 완료' })).toBeDisabled();

  // The phone's back gesture returns one step and keeps the choice.
  await page.goBack();
  await expect(page.getByRole('heading', { name: '어느 분의 근무표인가요?' })).toBeVisible();
  await expect(page).toHaveURL(/\/try$/);
  await expect(page.getByRole('radio', { name: person.name })).toBeChecked();
  await page.getByRole('button', { name: '내 근무 확인하기' }).click();

  const reviewDay = getDayButton(page, YEAR_MONTH, person.reviewDay);
  const printedCode = person.codes[person.reviewDay - 1] ?? '';

  await expect(reviewDay).toHaveAccessibleName(`11월 ${person.reviewDay}일 근무 미확인 확인 필요`);
  await reviewDay.click();
  await expect(page.getByText('원본: 읽지 못함')).toBeVisible();
  await expect(page.getByText(`흐린 글자: ${printedCode}`)).toBeVisible();
  await saveScreenshot(page, 'try-review');
  await getCodeButton(page, 'N 나이트').click();
  await expect(reviewDay).toHaveAccessibleName(`11월 ${person.reviewDay}일 N`);
  await expect(page.getByText('모든 날짜를 확인했어요')).toBeVisible();
  await page.getByRole('button', { name: '확인 완료' }).click();

  // Step 4: done — explained in text, one action.
  await expect(page.getByRole('heading', { name: /내 근무 달력이/ })).toBeFocused();
  await expect(page.getByText('공유 링크·캘린더 추가·이미지 저장을 할 수 있어요')).toBeVisible();
  await expect(page.getByRole('img', { name: `11월 ${person.reviewDay}일 N` })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'try-done');
  await saveScreenshot(page, 'try-done');

  // On-screen back and forward again: completion is reported once.
  await page.getByRole('button', { name: '결과 다시 확인' }).click();
  await expect(page.getByRole('heading', { name: /내 근무가 맞는지/ })).toBeVisible();
  await page.getByRole('button', { name: '확인 완료' }).click();
  await expect(page.getByRole('heading', { name: /내 근무 달력이/ })).toBeVisible();

  await expect.poll(() => countOf(watched.events, AnalyticsEvent.SAMPLE_STARTED)).toBe(1);
  await expect.poll(() => countOf(watched.events, AnalyticsEvent.SAMPLE_COMPLETED)).toBe(1);

  const unexpected = watched.paths.filter((entry) => {
    const path = entry.split(' ')[1] ?? '';

    return path !== EVENTS_PATH && !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
  });

  expect(unexpected, '체험 중 /api/events와 정적 파일 외 요청').toEqual([]);

  // CTA → the upload page's upload box (signed out too), file input focused (no picker after navigating).
  await page.getByRole('link', { name: '내 근무표로 만들기' }).click();
  await expect(page).toHaveURL(/\/upload#upload$/);
  await expect(page.getByRole('heading', { name: '근무표 사진을 올려 주세요' })).toBeInViewport();
  await expect(page.locator('input[type="file"]')).toBeFocused();
  await expect.poll(() => countOf(watched.events, AnalyticsEvent.SAMPLE_CTA_CLICKED)).toBe(1);
  expect(countOf(watched.events, AnalyticsEvent.SAMPLE_STARTED)).toBe(1);

  // Back from the upload page: a new visit of /try at step 1 (not the finished step)…
  await page.goBack();
  await expect(page).toHaveURL(/\/try$/);
  await expect(page.getByRole('heading', { name: '근무표를 읽었어요.' })).toBeVisible();

  // …and one more back leaves /try: the earlier visit's step entries are skipped, never restored.
  await page.goBack();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.getByRole('heading', { name: /근무표 한 장이면/ })).toBeVisible();

  // One sample_started per visit of /try (the second visit is the return from the upload page), none from history hops.
  await expect.poll(() => countOf(watched.events, AnalyticsEvent.SAMPLE_STARTED)).toBe(2);
  expect(countOf(watched.events, AnalyticsEvent.SAMPLE_COMPLETED)).toBe(1);
});

test('예시 체험: 로그인한 사용자도 쓰고, 새로고침 뒤 뒤로 가기도 한 번에 된다', async ({ page }) => {
  await devLoginViaApi(page.request, uniqueName('예시체험'));
  await page.goto('/try');
  await expect(page.getByRole('note').filter({ hasText: '예시 체험' })).toHaveText(
    '예시 체험 · 실제 저장되지 않아요',
  );
  await expect(page.getByRole('heading', { name: '근무표를 읽었어요.' })).toBeVisible();

  // A reload starts over.
  await page.getByRole('button', { name: '내 이름 고르기' }).click();
  await expect(page.getByRole('heading', { name: '어느 분의 근무표인가요?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '근무표를 읽었어요.' })).toBeVisible();

  // After the reload, the on-screen back returns to step 1 on the first click (the pre-reload entry is stale).
  await page.getByRole('button', { name: '내 이름 고르기' }).click();
  await expect(page.getByRole('heading', { name: '어느 분의 근무표인가요?' })).toBeVisible();
  await page.getByRole('button', { name: '근무표 다시 보기' }).click();
  await expect(page.getByRole('heading', { name: '근무표를 읽었어요.' })).toBeVisible();

  await page.getByRole('button', { name: '내 이름 고르기' }).click();
  await page.getByRole('button', { name: '내 근무 확인하기' }).click();

  const reviewDay = SAMPLE_ROSTER[0]?.reviewDay ?? 0;

  await getDayButton(page, YEAR_MONTH, reviewDay).click();
  await getCodeButton(page, 'E 이브닝').click();
  await page.getByRole('button', { name: '확인 완료' }).click();
  await page.getByRole('link', { name: '내 근무표로 만들기' }).click();
  await expect(page).toHaveURL(/\/upload#upload$/);
  await expect(page.locator('input[type="file"]')).toBeFocused();
});

test('이벤트 beacon: Chromium이 막지 않는 text/plain 본문으로 보낸다', async ({ page }) => {
  // Record what the page hands to the real sendBeacon and whether Chromium queued it (a non-safelisted type throws).
  await page.addInitScript(() => {
    const original = navigator.sendBeacon.bind(navigator);
    const calls: { type: string; queued: boolean | string }[] = [];

    (window as unknown as { beaconCalls: typeof calls }).beaconCalls = calls;
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const type = data instanceof Blob ? data.type : typeof data;

      try {
        const queued = original(url, data);

        calls.push({ type, queued });

        return queued;
      } catch (error) {
        calls.push({ type, queued: String(error) });
        throw error;
      }
    };
  });

  const eventRequest = page.waitForRequest((request) => pathOf(request) === EVENTS_PATH);

  await page.goto('/try');
  await eventRequest;

  const calls = await page.evaluate(
    () => (window as unknown as { beaconCalls: { type: string; queued: boolean | string }[] }).beaconCalls,
  );

  expect(calls[0]).toEqual({ type: 'text/plain;charset=utf-8', queued: true });
});
