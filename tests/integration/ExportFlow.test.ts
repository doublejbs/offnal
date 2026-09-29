import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as exportDataRoute } from '@/app/api/calendar/[yearMonth]/export-data/route';
import { GET as exportIcsRoute } from '@/app/api/calendar/[yearMonth]/export.ics/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import { entitlements } from '@/server/db/Schema';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { createLoggedInJob, createReadyDraft } from '../helpers/OffnalFlows';
import { findUserId, publishReady } from '../helpers/PaymentFlows';

let env: IntegrationEnvironment;
let owner: ApiTestClient;
let published: DraftResponse;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  owner = createApiTestClient();

  const jobId = await createLoggedInJob(owner, '내보내기 사용자');

  published = await createReadyDraft(owner, jobId, '2026-10');
  expect((await publishReady(owner, published)).status).toBe(200);
});

afterAll(async () => {
  await env.close();
});

const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');

const exportIcs = (client: ApiTestClient, yearMonth: string, query = '') =>
  client.send(exportIcsRoute, `/api/calendar/${yearMonth}/export.ics${query}`, { params: { yearMonth } });

const exportData = (client: ApiTestClient, yearMonth: string) =>
  client.send(exportDataRoute, `/api/calendar/${yearMonth}/export-data`, { params: { yearMonth } });

const countEvents = (ics: string): number => ics.split('BEGIN:VEVENT').length - 1;

const datesWithCode = (code: string): string[] =>
  published.draft.entries.filter((entry) => entry.code === code).map((entry) => entry.date);

describe('ICS export', () => {
  it('returns an attachment with correct headers and night shifts ending the next day', async () => {
    const response = await exportIcs(owner, '2026-10');
    const ics = unfold(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="offnal-2026-10.ics"');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Seoul');

    const nightDate = datesWithCode('N')[0] ?? '';
    const compact = nightDate.replace(/-/g, '');

    expect(nightDate).not.toBe('');
    // 22:30 KST = 13:30Z the same day; 07:30 KST the next day = 22:30Z (Spec mock times).
    expect(ics).toContain(`DTSTART:${compact}T133000Z`);
    expect(ics).toContain(`DTEND:${compact}T223000Z`);

    const offDates = datesWithCode('OFF');

    expect(offDates.length).toBeGreaterThan(0);
    expect(countEvents(ics)).toBe(published.draft.entries.length - offDates.length);
    expect(ics).not.toContain('DTSTART;VALUE=DATE:');
  });

  it('includes days off as all-day events with includeOff=1', async () => {
    const response = await exportIcs(owner, '2026-10', '?includeOff=1');
    const ics = unfold(await response.text());
    const offDate = (datesWithCode('OFF')[0] ?? '').replace(/-/g, '');

    expect(response.status).toBe(200);
    expect(countEvents(ics)).toBe(published.draft.entries.length);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${offDate}`);
  });

  it('is 404 for other users, unpublished or invalid months and 401 when logged out', async () => {
    const stranger = createApiTestClient();

    await createLoggedInJob(stranger, '내보내기 침입자');

    expect((await exportIcs(stranger, '2026-10')).status).toBe(404);
    expect((await exportIcs(owner, '2026-11')).status).toBe(404);
    expect((await exportIcs(owner, '2026-13')).status).toBe(404);
    expect((await exportIcs(createApiTestClient(), '2026-10')).status).toBe(401);
  });
});

describe('export data', () => {
  it('returns the published snapshot for the PNG renderer', async () => {
    const response = await exportData(owner, '2026-10');
    const body = await readJson<ExportDataResponse>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(body).toMatchObject({
      displayName: published.draft.displayName,
      yearMonth: '2026-10',
      entries: published.draft.entries,
      definitions: published.draft.definitions,
    });
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);
  });

  it('is 404 for other users and 402 once the entitlement is missing', async () => {
    const stranger = createApiTestClient();

    await createLoggedInJob(stranger, '데이터 침입자');

    expect((await exportData(stranger, '2026-10')).status).toBe(404);

    const userId = await findUserId(env.db, '내보내기 사용자');

    await env.db
      .delete(entitlements)
      .where(and(eq(entitlements.userId, userId), eq(entitlements.yearMonth, '2026-10')));

    const data = await exportData(owner, '2026-10');
    const ics = await exportIcs(owner, '2026-10');

    expect(data.status).toBe(402);
    expect((await readJson<ApiErrorBody>(data)).error.code).toBe(ApiErrorCode.PAYMENT_REQUIRED);
    expect(ics.status).toBe(402);
  });
});
