import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GET as getMonthRoute } from '@/app/api/calendar/[yearMonth]/route';
import { GET as calendarRoute } from '@/app/api/calendar/route';
import { POST as rotateShareRoute } from '@/app/api/calendar/share/rotate/route';
import {
  DELETE as disableShareRoute,
  GET as getShareRoute,
  POST as updateShareRoute,
} from '@/app/api/calendar/share/route';
import { GET as sharedRoute } from '@/app/api/shared/[token]/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { SHARE_EXPIRED_MESSAGE } from '@/domain/ShareMessages';
import { MOCK_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  TEST_APP_URL,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createLoggedInJob, createReadyDraft } from '../helpers/OffnalFlows';
import { publishReady } from '../helpers/PaymentFlows';

const SELECTED_PERSON = MOCK_CANDIDATE_NAMES[0] ?? '';
const OTHER_PEOPLE = MOCK_CANDIDATE_NAMES.slice(1);

let env: IntegrationEnvironment;
const envSandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
});

afterEach(() => {
  envSandbox.restore();
});

afterAll(async () => {
  await env.close();
});

const updateShare = (client: ApiTestClient, body: unknown, origin?: string) =>
  client.send(updateShareRoute, '/api/calendar/share', { json: body, ...(origin ? { origin } : {}) });

const readShareSettings = async (client: ApiTestClient): Promise<ShareSettingsResponse> => {
  const response = await client.send(getShareRoute, '/api/calendar/share');

  expect(response.status).toBe(200);

  return readJson<ShareSettingsResponse>(response);
};

const tokenFromUrl = (url: string | null): string => {
  const parsed = new URL(url ?? '');

  expect(parsed.origin).toBe(TEST_APP_URL);
  expect(parsed.pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);

  return parsed.pathname.slice('/s/'.length);
};

const viewShared = (token: string, month?: string): Promise<Response> => {
  const viewer = createApiTestClient();
  const query = month ? `?month=${month}` : '';

  return viewer.send(sharedRoute, `/api/shared/${token}${query}`, { params: { token }, origin: null });
};

const expectPublicHeaders = (response: Response): void => {
  expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
};

const expectExpired = async (response: Response): Promise<void> => {
  const body = await readJson<ApiErrorBody>(response);

  expect(response.status).toBe(404);
  expect(body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  expect(body.error.message).toBe(SHARE_EXPIRED_MESSAGE);
  expectPublicHeaders(response);
};

/** Logs in and publishes the given months (first mock row = the selected person). */
const setupPublished = async (displayName: string, months: string[]): Promise<ApiTestClient> => {
  const client = createApiTestClient();
  const jobId = await createLoggedInJob(client, displayName);
  const drafts = [];

  for (const month of months) {
    drafts.push(await createReadyDraft(client, jobId, month));
  }

  for (const draft of drafts) {
    expect((await publishReady(client, draft)).status).toBe(200);
  }

  return client;
};

describe('share settings', () => {
  it('requires a published calendar before enabling', async () => {
    const client = createApiTestClient();

    await createLoggedInJob(client, '공유 없는 사용자');

    expect(await readShareSettings(client)).toEqual({
      enabled: false,
      url: null,
      displayName: '공유 없는 사용자',
      visibleMonths: [],
      availableMonths: [],
    });

    const response = await updateShare(client, { displayName: '이름', visibleMonths: [] });

    expect(response.status).toBe(404);
    expect((await readJson<ApiErrorBody>(response)).error.message).toContain('달력');
    expect((await createApiTestClient().send(getShareRoute, '/api/calendar/share')).status).toBe(401);
  });

  it('validates the display name, the months and the origin', async () => {
    const client = await setupPublished('공유 검증 사용자', ['2026-10']);

    expect((await updateShare(client, { displayName: '가'.repeat(41), visibleMonths: [] })).status).toBe(400);
    expect((await updateShare(client, { displayName: ' ', visibleMonths: [] })).status).toBe(400);
    expect((await updateShare(client, { displayName: '이름', visibleMonths: ['2026-13'] })).status).toBe(400);

    const notPublished = await updateShare(client, {
      displayName: '이름',
      visibleMonths: ['2026-10', '2027-05'],
    });

    expect(notPublished.status).toBe(400);
    expect((await readJson<ApiErrorBody>(notPublished)).error.details).toEqual({
      invalidMonths: ['2027-05'],
    });
    expect(
      (await updateShare(client, { displayName: '이름', visibleMonths: ['2026-10'] }, 'https://evil.example'))
        .status,
    ).toBe(403);
    expect((await readShareSettings(client)).enabled).toBe(false);
  });
});

describe('shared calendar', () => {
  it('shows only visible months, without review data, sources or other people', async () => {
    const client = await setupPublished('공유 사용자', ['2026-10', '2026-11']);
    const monthBefore = await readJson<CalendarMonthResponse>(
      await client.send(getMonthRoute, '/api/calendar/2026-10', { params: { yearMonth: '2026-10' } }),
    );
    const response = await updateShare(client, { displayName: SELECTED_PERSON, visibleMonths: ['2026-10'] });
    const settings = await readJson<ShareSettingsResponse>(response);

    expect(response.status).toBe(200);
    expect(settings).toMatchObject({
      enabled: true,
      displayName: SELECTED_PERSON,
      visibleMonths: ['2026-10'],
      availableMonths: ['2026-10', '2026-11'],
    });

    const token = tokenFromUrl(settings.url);

    expect(await readShareSettings(client)).toEqual(settings);

    const summary = await readJson<CalendarSummaryResponse>(
      await client.send(calendarRoute, '/api/calendar'),
    );

    expect(summary.share).toEqual({ enabled: true, url: settings.url, displayName: SELECTED_PERSON });
    expect(summary.months.map((month) => [month.yearMonth, month.shareVisible])).toEqual([
      ['2026-10', true],
      ['2026-11', false],
    ]);

    const monthAfter = await readJson<CalendarMonthResponse>(
      await client.send(getMonthRoute, '/api/calendar/2026-10', { params: { yearMonth: '2026-10' } }),
    );

    // Changing visibility is not an edit of the month.
    expect(monthAfter.updatedAt).toBe(monthBefore.updatedAt);

    const shared = await viewShared(token);
    const text = await shared.clone().text();
    const body = await readJson<SharedCalendarResponse>(shared);

    expect(shared.status).toBe(200);
    expectPublicHeaders(shared);
    expect(body.displayName).toBe(SELECTED_PERSON);
    expect(body.months).toEqual(['2026-10']);
    expect(body.month?.yearMonth).toBe('2026-10');
    expect(body.month?.updatedAt).toBe(monthBefore.updatedAt);
    expect(body.month?.entries).toHaveLength(31);
    expect(Object.keys(body.month?.entries[0] ?? {}).sort()).toEqual(['code', 'date']);
    expect(body.month?.definitions.map((definition) => definition.code)).toContain('N');

    for (const forbidden of [
      ...OTHER_PEOPLE,
      'reviewReasons',
      'confirmed',
      'rawText',
      'sourceCells',
      'source',
    ]) {
      expect(text).not.toContain(forbidden);
    }

    const explicit = await viewShared(token, '2026-10');

    expect(explicit.status).toBe(200);
    expect((await readJson<SharedCalendarResponse>(explicit)).month?.yearMonth).toBe('2026-10');

    await expectExpired(await viewShared(token, '2026-11'));
    await expectExpired(await viewShared(token, '2026-12'));
    await expectExpired(await viewShared(token, 'bad'));
  });

  it('does not show a month published after sharing until the owner makes it visible', async () => {
    const client = createApiTestClient();
    const jobId = await createLoggedInJob(client, '새 달 사용자');
    const october = await createReadyDraft(client, jobId, '2026-10');
    const november = await createReadyDraft(client, jobId, '2026-11');

    await publishReady(client, october);

    const settings = await readJson<ShareSettingsResponse>(
      await updateShare(client, { displayName: '새 달', visibleMonths: ['2026-10'] }),
    );
    const token = tokenFromUrl(settings.url);

    expect((await publishReady(client, november)).status).toBe(200);

    const shared = await readJson<SharedCalendarResponse>(await viewShared(token));

    expect(shared.months).toEqual(['2026-10']);
    await expectExpired(await viewShared(token, '2026-11'));
    expect((await readShareSettings(client)).visibleMonths).toEqual(['2026-10']);

    const updated = await readJson<ShareSettingsResponse>(
      await updateShare(client, { displayName: '새 달', visibleMonths: ['2026-11', '2026-10', '2026-11'] }),
    );

    expect(updated.url).toBe(settings.url);
    expect(updated.visibleMonths).toEqual(['2026-10', '2026-11']);

    const latest = await readJson<SharedCalendarResponse>(await viewShared(token));

    expect(latest.months).toEqual(['2026-10', '2026-11']);
    expect(latest.month?.yearMonth).toBe('2026-11');

    const hidden = await readJson<SharedCalendarResponse>(
      await viewShared(
        tokenFromUrl(
          (
            await readJson<ShareSettingsResponse>(
              await updateShare(client, { displayName: '새 달', visibleMonths: [] }),
            )
          ).url,
        ),
      ),
    );

    expect(hidden).toEqual({ displayName: '새 달', months: [], month: null });
  });

  it('rotating invalidates the old link immediately; disabling stops the link', async () => {
    const client = await setupPublished('재발급 사용자', ['2026-10']);
    const settings = await readJson<ShareSettingsResponse>(
      await updateShare(client, { displayName: '재발급', visibleMonths: ['2026-10'] }),
    );
    const oldToken = tokenFromUrl(settings.url);
    const rotateResponse = await client.send(rotateShareRoute, '/api/calendar/share/rotate', {
      method: 'POST',
    });
    const rotated = await readJson<ShareSettingsResponse>(rotateResponse);
    const newToken = tokenFromUrl(rotated.url);

    expect(rotateResponse.status).toBe(200);
    expect(newToken).not.toBe(oldToken);
    expect(rotated).toMatchObject({ enabled: true, visibleMonths: ['2026-10'] });
    await expectExpired(await viewShared(oldToken));
    expect((await viewShared(newToken)).status).toBe(200);

    const disableResponse = await client.send(disableShareRoute, '/api/calendar/share', { method: 'DELETE' });
    const disabled = await readJson<ShareSettingsResponse>(disableResponse);

    expect(disableResponse.status).toBe(200);
    expect(disabled).toMatchObject({ enabled: false, url: null });
    await expectExpired(await viewShared(newToken));

    const summary = await readJson<CalendarSummaryResponse>(
      await client.send(calendarRoute, '/api/calendar'),
    );

    expect(summary.share).toMatchObject({ enabled: false, url: null });

    const rotateDisabled = await client.send(rotateShareRoute, '/api/calendar/share/rotate', {
      method: 'POST',
    });

    expect(rotateDisabled.status).toBe(404);

    const reenabled = await readJson<ShareSettingsResponse>(
      await updateShare(client, { displayName: '재발급', visibleMonths: ['2026-10'] }),
    );

    expect(tokenFromUrl(reenabled.url)).not.toBe(newToken);
    await expectExpired(await viewShared(newToken));
  });

  it('answers unknown or malformed tokens with the same 404 and rate-limits by IP', async () => {
    await expectExpired(await viewShared('A'.repeat(43)));
    await expectExpired(await viewShared('short'));

    envSandbox.set({ RATE_LIMIT_SHARED_IP_DAILY: '2' });

    const viewer = createApiTestClient();
    const view = () =>
      viewer.send(sharedRoute, `/api/shared/${'B'.repeat(43)}`, {
        params: { token: 'B'.repeat(43) },
        origin: null,
      });

    expect((await view()).status).toBe(404);
    expect((await view()).status).toBe(404);

    const limited = await view();

    expect(limited.status).toBe(429);
    expectPublicHeaders(limited);
  });
});
