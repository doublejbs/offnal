import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as editMonthRoute } from '@/app/api/calendar/[yearMonth]/edit/route';
import { GET as exportDataRoute } from '@/app/api/calendar/[yearMonth]/export-data/route';
import { GET as exportIcsRoute } from '@/app/api/calendar/[yearMonth]/export.ics/route';
import { DELETE as deleteMonthRoute, GET as getMonthRoute } from '@/app/api/calendar/[yearMonth]/route';
import { GET as calendarRoute } from '@/app/api/calendar/route';
import { GET as getShareRoute, POST as updateShareRoute } from '@/app/api/calendar/share/route';
import { GET as sharedIcsRoute } from '@/app/api/shared/[token]/export.ics/route';
import { GET as sharedRoute } from '@/app/api/shared/[token]/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { type AckTeamChangesResponse } from '@/domain/types/api/AckTeamChangesResponse';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type CreateRosterDraftResponse } from '@/domain/types/api/CreateRosterDraftResponse';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { type TeamMyMonthsResponse } from '@/domain/types/api/TeamMyMonthsResponse';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type DraftResponse } from '@/domain/types/api/DraftResponse';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
} from '../helpers/ApiTestClient';
import { getEvents, unfold } from '../helpers/IcsTestUtils';
import { findRowKey } from '../helpers/TeamRosterAssertions';
import { createLoggedInJob, createReadyDraft } from '../helpers/OffnalFlows';
import { findUserId, publishReady } from '../helpers/PaymentFlows';
import { approveMember, leaveTeam, removeMember, requestJoin } from '../helpers/TeamFlows';
import {
  ackChanges,
  createRosterDraft,
  getMyMonths,
  joinAndApprove,
  patchRoster,
  publishReadyRoster,
  type PublishedTeam,
  readRoster,
  setupPublishedTeam,
  TEAM_MONTH,
  uploadAndPublishRoster,
} from '../helpers/TeamRosterFlows';

const PERSONAL_ONLY_MONTH = '2026-10';
const TEAM_ONLY_MONTH = '2026-12';
const TEAM_NAME = '달력 병동';

let env: IntegrationEnvironment;
let team: PublishedTeam;
let member: ApiTestClient;
let personalNovember: DraftResponse;
let teamOnlyDraft: DraftResponse;

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  team = await setupPublishedTeam('달력 관리자', TEAM_NAME);
  await uploadAndPublishRoster(team.admin, team.teamId, { yearMonth: TEAM_ONLY_MONTH });

  // The member saved two personal months (both free months used) before joining the team.
  member = createApiTestClient();

  const jobId = await createLoggedInJob(member, '달력 팀원');
  const october = await createReadyDraft(member, jobId, PERSONAL_ONLY_MONTH);

  personalNovember = await createReadyDraft(member, jobId, TEAM_MONTH);
  teamOnlyDraft = await createReadyDraft(member, jobId, TEAM_ONLY_MONTH);
  expect((await publishReady(member, october)).status).toBe(200);
  expect((await publishReady(member, personalNovember)).status).toBe(200);

  const linked = await loggedInMemberJoin(member, '이여름');

  expect(linked).toBe(200);
});

afterAll(async () => {
  await env.close();
});

/** Requests the row with the member's existing session and lets the admin approve. */
const loggedInMemberJoin = async (client: ApiTestClient, rowName: string): Promise<number> => {
  expect((await requestJoin(client, team.token, findRowKey(team.roster, rowName))).status).toBe(200);

  return (await approveMember(team.admin, team.teamId, await findUserId(env.db, '달력 팀원'))).status;
};

const readSummary = async (client: ApiTestClient): Promise<CalendarSummaryResponse> =>
  readJson<CalendarSummaryResponse>(await client.send(calendarRoute, '/api/calendar'));

const getMonth = (client: ApiTestClient, yearMonth: string) =>
  client.send(getMonthRoute, `/api/calendar/${yearMonth}`, { params: { yearMonth } });

const readMonth = async (client: ApiTestClient, yearMonth: string): Promise<CalendarMonthResponse> => {
  const response = await getMonth(client, yearMonth);

  expect(response.status).toBe(200);

  return readJson<CalendarMonthResponse>(response);
};

const exportIcs = (client: ApiTestClient, yearMonth: string) =>
  client.send(exportIcsRoute, `/api/calendar/${yearMonth}/export.ics`, { params: { yearMonth } });

const exportData = (client: ApiTestClient, yearMonth: string) =>
  client.send(exportDataRoute, `/api/calendar/${yearMonth}/export-data`, { params: { yearMonth } });

const updateShare = (client: ApiTestClient, visibleMonths: string[]) =>
  client.send(updateShareRoute, '/api/calendar/share', { json: { displayName: '이여름', visibleMonths } });

const viewShared = (token: string, month?: string) =>
  createApiTestClient().send(sharedRoute, `/api/shared/${token}${month ? `?month=${month}` : ''}`, {
    params: { token },
    origin: null,
  });

const tokenOf = (settings: ShareSettingsResponse): string =>
  new URL(settings.url ?? '').pathname.slice('/s/'.length);

const teamRowCodes = (roster: TeamRosterResponse, name: string): (string | null)[] =>
  roster.rows.find((row) => row.displayName === name)?.entries.map((entry) => entry.code) ?? [];

describe('team months in the member calendar', () => {
  it('shows the team month instead of the personal one, read-only', async () => {
    const summary = await readSummary(member);

    expect(summary.months.map((month) => [month.yearMonth, month.source, month.hasPersonalBackup])).toEqual([
      [PERSONAL_ONLY_MONTH, CalendarMonthSource.PERSONAL, false],
      [TEAM_MONTH, CalendarMonthSource.TEAM, true],
      [TEAM_ONLY_MONTH, CalendarMonthSource.TEAM, false],
    ]);
    expect(summary.months[1]?.team).toMatchObject({
      teamId: team.teamId,
      teamName: TEAM_NAME,
      revision: 1,
      changes: [],
    });
    // Team months never use the personal free months.
    expect(summary.freeRemaining).toBe(0);

    const month = await readMonth(member, TEAM_MONTH);

    expect(month).toMatchObject({
      source: CalendarMonthSource.TEAM,
      readOnly: true,
      revision: 1,
      hasPersonalBackup: true,
    });
    expect(month.entries.map((entry) => entry.code)).toEqual(teamRowCodes(team.roster, '이여름'));
    expect(month.entries.every((entry) => entry.reviewReasons.length === 0 && entry.confirmed)).toBe(true);
    expect(month.team?.teamName).toBe(TEAM_NAME);

    const personal = await readMonth(member, PERSONAL_ONLY_MONTH);

    expect(personal).toMatchObject({ source: CalendarMonthSource.PERSONAL, readOnly: false, team: null });
  });

  it('refuses edits and deletion of team months', async () => {
    const edit = await member.send(editMonthRoute, `/api/calendar/${TEAM_MONTH}/edit`, {
      method: 'POST',
      params: { yearMonth: TEAM_MONTH },
    });
    const body = await readJson<ApiErrorBody>(edit);

    expect(edit.status).toBe(409);
    expect(body.error).toMatchObject({
      code: ApiErrorCode.TEAM_MONTH_READ_ONLY,
      message: '팀 근무표는 관리자만 수정할 수 있어요.',
    });

    const removal = await member.send(deleteMonthRoute, `/api/calendar/${TEAM_MONTH}`, {
      method: 'DELETE',
      params: { yearMonth: TEAM_MONTH },
    });

    expect(removal.status).toBe(409);
    expect((await readJson<ApiErrorBody>(removal)).error.code).toBe(ApiErrorCode.TEAM_MONTH_READ_ONLY);
  });

  it('refuses a personal save of a month the team publishes (no free month spent)', async () => {
    const response = await publishReady(member, teamOnlyDraft);

    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.TEAM_MONTH_READ_ONLY);
  });

  it('exports team months without an entitlement (ICS and PNG data)', async () => {
    const ics = await exportIcs(member, TEAM_ONLY_MONTH);
    const text = unfold(await ics.text());

    expect(ics.status).toBe(200);
    expect(ics.headers.get('content-disposition')).toBe(
      `attachment; filename="offnal-${TEAM_ONLY_MONTH}.ics"`,
    );
    expect(getEvents(text).length).toBeGreaterThan(10);

    const data = await exportData(member, TEAM_ONLY_MONTH);
    const dataBody = await readJson<ExportDataResponse>(data);

    expect(data.status).toBe(200);
    expect(dataBody).toMatchObject({ yearMonth: TEAM_ONLY_MONTH, teamName: TEAM_NAME });
    expect(dataBody.entries.every((entry) => entry.reviewReasons.length === 0)).toBe(true);

    const personal = await readJson<ExportDataResponse>(await exportData(member, PERSONAL_ONLY_MONTH));

    expect(personal.teamName).toBeNull();
  });

  it('reflects a new revision immediately with change marks until acknowledged', async () => {
    const roster = await readRoster(team.admin, team.teamId, team.rosterId);
    const draftResponse = await createRosterDraft(team.admin, team.teamId, roster.roster.id);
    const { rosterId: draftId } = await readJson<CreateRosterDraftResponse>(draftResponse);
    const draft = await readRoster(team.admin, team.teamId, draftId);
    const row = draft.rows.find((item) => item.displayName === '이여름');
    const fromCode = row?.entries[4]?.code ?? null;
    const toCode = fromCode === 'N' ? 'D' : 'N';
    const edited = await readJson<TeamRosterResponse>(
      await patchRoster(team.admin, team.teamId, draftId, {
        version: draft.roster.version,
        rows: [
          {
            rowId: row?.id,
            entries: row?.entries.map((entry, index) => (index === 4 ? { ...entry, code: toCode } : entry)),
          },
        ],
      }),
    );

    await publishReadyRoster(team.admin, team.teamId, edited);

    const month = await readMonth(member, TEAM_MONTH);
    const expectedChange = { date: `${TEAM_MONTH}-05`, fromCode, toCode };

    expect(month.revision).toBe(2);
    expect(month.entries[4]?.code).toBe(toCode);
    expect(month.team?.changes).toEqual([expectedChange]);
    expect((await readSummary(member)).months[1]?.team?.changes).toEqual([expectedChange]);

    const myMonths = await readJson<TeamMyMonthsResponse>(await getMyMonths(member, team.teamId));

    expect(myMonths.months.find((item) => item.yearMonth === TEAM_MONTH)).toMatchObject({
      revision: 2,
      acknowledgedRevision: 1,
      changes: [expectedChange],
    });

    const ack = await ackChanges(member, team.teamId, { yearMonth: TEAM_MONTH, revision: 99 });

    expect(await readJson<AckTeamChangesResponse>(ack)).toEqual({
      yearMonth: TEAM_MONTH,
      acknowledgedRevision: 2,
    });
    expect((await readMonth(member, TEAM_MONTH)).team?.changes).toEqual([]);
    expect((await ackChanges(member, team.teamId, { yearMonth: '2027-03', revision: 1 })).status).toBe(404);
  });
});

describe('team months on the share link', () => {
  let token: string;

  it('lists team months in the picker but keeps them hidden until the member turns them on', async () => {
    const before = await readJson<ShareSettingsResponse>(
      await member.send(getShareRoute, '/api/calendar/share'),
    );

    expect(before.availableMonths).toEqual([PERSONAL_ONLY_MONTH, TEAM_MONTH, TEAM_ONLY_MONTH]);
    expect(before.teamMonths).toEqual([TEAM_MONTH, TEAM_ONLY_MONTH]);
    expect(before.visibleMonths).toEqual([]);

    const enabled = await readJson<ShareSettingsResponse>(await updateShare(member, [PERSONAL_ONLY_MONTH]));

    token = tokenOf(enabled);

    const shared = await readJson<SharedCalendarResponse>(await viewShared(token));

    expect(shared.months).toEqual([PERSONAL_ONLY_MONTH]);
    expect((await viewShared(token, TEAM_MONTH)).status).toBe(404);
  });

  it('shows a visible team month with team codes only, in the page and the ICS file', async () => {
    const settings = await readJson<ShareSettingsResponse>(
      await updateShare(member, [PERSONAL_ONLY_MONTH, TEAM_MONTH]),
    );

    expect(settings.visibleMonths).toEqual([PERSONAL_ONLY_MONTH, TEAM_MONTH]);

    const response = await viewShared(token, TEAM_MONTH);
    const text = await response.clone().text();
    const shared = await readJson<SharedCalendarResponse>(response);
    const ownMonth = await readMonth(member, TEAM_MONTH);

    expect(shared.months).toEqual([PERSONAL_ONLY_MONTH, TEAM_MONTH]);
    expect(shared.month?.entries).toEqual(
      ownMonth.entries.map((entry) => ({ date: entry.date, code: entry.code })),
    );
    expect(text).not.toContain('김하루');
    expect(text).not.toContain(TEAM_NAME);

    const ics = await createApiTestClient().send(
      sharedIcsRoute,
      `/api/shared/${token}/export.ics?month=${TEAM_MONTH}`,
      {
        params: { token },
        origin: null,
      },
    );

    expect(ics.status).toBe(200);
    expect(getEvents(unfold(await ics.text())).length).toBeGreaterThan(10);
  });

  it('drops team months from calendar and link after leaving, and restores the personal month', async () => {
    expect((await leaveTeam(member, team.teamId)).status).toBe(200);

    const summary = await readSummary(member);

    expect(summary.months.map((month) => [month.yearMonth, month.source])).toEqual([
      [PERSONAL_ONLY_MONTH, CalendarMonthSource.PERSONAL],
      [TEAM_MONTH, CalendarMonthSource.PERSONAL],
    ]);

    const restored = await readMonth(member, TEAM_MONTH);

    expect(restored).toMatchObject({ source: CalendarMonthSource.PERSONAL, readOnly: false });
    expect(restored.entries).toEqual(personalNovember.draft.entries);
    expect((await getMonth(member, TEAM_ONLY_MONTH)).status).toBe(404);
    expect((await exportIcs(member, TEAM_ONLY_MONTH)).status).toBe(404);

    // The hidden personal November keeps its own (never enabled) visibility.
    const shared = await readJson<SharedCalendarResponse>(await viewShared(token));

    expect(shared.months).toEqual([PERSONAL_ONLY_MONTH]);
    expect((await viewShared(token, TEAM_ONLY_MONTH)).status).toBe(404);
  });
});

describe('team-only members', () => {
  it('get a calendar, share link and exports from team months alone; removal ends it', async () => {
    const { member: newcomer, userId } = await joinAndApprove(
      env.db,
      team,
      '팀 전용 팀원',
      findRowKey(team.roster, '박지우'),
    );
    const summary = await readSummary(newcomer);

    expect(summary.months.map((month) => month.yearMonth)).toEqual([TEAM_MONTH, TEAM_ONLY_MONTH]);
    expect(summary.freeRemaining).toBe(2);

    const settings = await readJson<ShareSettingsResponse>(
      await newcomer.send(updateShareRoute, '/api/calendar/share', {
        json: { displayName: '박지우', visibleMonths: [TEAM_ONLY_MONTH] },
      }),
    );
    const shareToken = tokenOf(settings);

    expect((await readJson<SharedCalendarResponse>(await viewShared(shareToken))).months).toEqual([
      TEAM_ONLY_MONTH,
    ]);
    expect((await exportIcs(newcomer, TEAM_MONTH)).status).toBe(200);

    expect((await removeMember(team.admin, team.teamId, userId)).status).toBe(200);
    expect((await readSummary(newcomer)).months).toEqual([]);
    expect((await readJson<SharedCalendarResponse>(await viewShared(shareToken))).months).toEqual([]);
    expect((await readJson<SharedCalendarResponse>(await viewShared(shareToken))).month).toBeNull();
  });
});
