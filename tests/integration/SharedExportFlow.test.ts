import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { POST as rotateShareRoute } from '@/app/api/calendar/share/rotate/route';
import { DELETE as disableShareRoute, POST as updateShareRoute } from '@/app/api/calendar/share/route';
import { GET as sharedIcsRoute } from '@/app/api/shared/[token]/export.ics/route';
import { GET as sharedRoute } from '@/app/api/shared/[token]/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { SHARE_EXPIRED_MESSAGE } from '@/domain/ShareMessages';
import { calendars } from '@/server/db/Schema';
import { MOCK_CANDIDATE_NAMES } from '@/server/vision/MockVisionProvider';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { getEvents, unfold } from '../helpers/IcsTestUtils';
import { createLoggedInJob, createReadyDraft } from '../helpers/OffnalFlows';
import { findUserId, publishReady } from '../helpers/PaymentFlows';

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

const exportShared = (token: string, query = ''): Promise<Response> =>
  createApiTestClient().send(sharedIcsRoute, `/api/shared/${token}/export.ics${query}`, {
    params: { token },
    origin: null,
  });

const viewShared = async (token: string, month: string): Promise<SharedCalendarResponse> => {
  const response = await createApiTestClient().send(sharedRoute, `/api/shared/${token}?month=${month}`, {
    params: { token },
    origin: null,
  });

  expect(response.status).toBe(200);

  return readJson<SharedCalendarResponse>(response);
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

type SharedSetup = {
  client: ApiTestClient;
  token: string;
  calendarId: string;
};

/** Publishes 2026-10 and 2026-11, shares only 2026-10 under the selected person's name. */
const setupShared = async (loginName: string): Promise<SharedSetup> => {
  const client = createApiTestClient();
  const jobId = await createLoggedInJob(client, loginName);
  const october = await createReadyDraft(client, jobId, '2026-10');
  const november = await createReadyDraft(client, jobId, '2026-11');

  expect((await publishReady(client, october)).status).toBe(200);
  expect((await publishReady(client, november)).status).toBe(200);

  const response = await client.send(updateShareRoute, '/api/calendar/share', {
    json: { displayName: SELECTED_PERSON, visibleMonths: ['2026-10'] },
  });
  const settings = await readJson<ShareSettingsResponse>(response);

  expect(response.status).toBe(200);

  const token = new URL(settings.url ?? '').pathname.slice('/s/'.length);
  const ownerId = await findUserId(env.db, loginName);
  const [calendar] = await env.db.select().from(calendars).where(eq(calendars.ownerId, ownerId));

  if (!calendar) {
    throw new Error('calendar expected');
  }

  return { client, token, calendarId: calendar.id };
};

describe('shared ICS export', () => {
  it('returns the visible month as a prefixed, uuid-free one-time import file', async () => {
    const { token, calendarId } = await setupShared('받은 사람 내보내기 사용자');
    const shared = await viewShared(token, '2026-10');
    const definitions = shared.month?.definitions ?? [];
    const offCodes = new Set(definitions.filter((definition) => definition.isOff).map((item) => item.code));
    const entries = (shared.month?.entries ?? []).filter((entry) => entry.code !== null);
    const workDays = entries.filter((entry) => !offCodes.has(entry.code ?? ''));
    const offDays = entries.filter((entry) => offCodes.has(entry.code ?? ''));

    expect(workDays.length).toBeGreaterThan(0);
    expect(offDays.length).toBeGreaterThan(0);

    const response = await exportShared(token, '?month=2026-10');
    const raw = await response.text();
    const ics = unfold(raw);
    const events = getEvents(ics);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="offnal-shared-2026-10.ics"',
    );
    expectPublicHeaders(response);
    expect(ics).toContain(`X-WR-CALNAME:${SELECTED_PERSON}님의 근무 · 2026년 10월\r\n`);
    expect(events).toHaveLength(workDays.length);

    for (const event of events) {
      expect(event).toMatch(new RegExp(`SUMMARY:${SELECTED_PERSON} · .+ \\(.+\\)\\r\\n`));
      expect(event).toMatch(/UID:[0-9a-f]{16}-2026-10-\d{2}@offnal\r\n/);
    }

    expect(raw).not.toContain(calendarId);
    expect(raw).not.toContain(token);

    for (const forbidden of OTHER_PEOPLE) {
      expect(raw).not.toContain(forbidden);
    }

    const withOff = unfold(await (await exportShared(token, '?month=2026-10&includeOff=1')).text());
    const allDay = getEvents(withOff).filter((event) => event.includes('DTSTART;VALUE=DATE:'));

    expect(getEvents(withOff)).toHaveLength(workDays.length + offDays.length);
    expect(allDay).toHaveLength(offDays.length);

    // UIDs stay stable across downloads.
    const uids = (text: string) => getEvents(text).map((event) => /UID:(.*)/.exec(event)?.[1]);

    expect(uids(unfold(await (await exportShared(token, '?month=2026-10')).text()))).toEqual(uids(ics));
  });

  it('defaults to the latest visible month and hides the rest with the same 404', async () => {
    const { token } = await setupShared('받은 사람 기본 월 사용자');
    const latest = await exportShared(token);

    expect(latest.status).toBe(200);
    expect(latest.headers.get('content-disposition')).toBe(
      'attachment; filename="offnal-shared-2026-10.ics"',
    );

    await expectExpired(await exportShared(token, '?month=2026-11'));
    await expectExpired(await exportShared(token, '?month=2026-12'));
    await expectExpired(await exportShared(token, '?month=bad'));
    await expectExpired(await exportShared('A'.repeat(43), '?month=2026-10'));
    await expectExpired(await exportShared('short'));
  });

  it('stops working after rotating or disabling the link', async () => {
    const { client, token } = await setupShared('받은 사람 재발급 사용자');

    expect(
      (await client.send(rotateShareRoute, '/api/calendar/share/rotate', { method: 'POST' })).status,
    ).toBe(200);
    await expectExpired(await exportShared(token, '?month=2026-10'));

    const second = await setupShared('받은 사람 중지 사용자');

    expect((await exportShared(second.token, '?month=2026-10')).status).toBe(200);
    expect(
      (await second.client.send(disableShareRoute, '/api/calendar/share', { method: 'DELETE' })).status,
    ).toBe(200);
    await expectExpired(await exportShared(second.token, '?month=2026-10'));
  });

  it('shares the shared-view IP rate limit', async () => {
    envSandbox.set({ RATE_LIMIT_SHARED_IP_DAILY: '2' });

    const viewer = createApiTestClient();
    const token = 'C'.repeat(43);
    const download = () =>
      viewer.send(sharedIcsRoute, `/api/shared/${token}/export.ics`, { params: { token }, origin: null });

    expect((await download()).status).toBe(404);
    expect(
      (await viewer.send(sharedRoute, `/api/shared/${token}`, { params: { token }, origin: null })).status,
    ).toBe(404);

    const limited = await download();

    expect(limited.status).toBe(429);
    expectPublicHeaders(limited);
  });
});
