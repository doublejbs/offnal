import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GET as exportDataRoute } from '@/app/api/calendar/[yearMonth]/export-data/route';
import { GET as exportIcsRoute } from '@/app/api/calendar/[yearMonth]/export.ics/route';
import { GET as getMonthRoute } from '@/app/api/calendar/[yearMonth]/route';
import { GET as calendarRoute } from '@/app/api/calendar/route';
import { POST as updateShareRoute } from '@/app/api/calendar/share/route';
import { GET as sharedRoute } from '@/app/api/shared/[token]/route';
import { POST as createTeamRoute } from '@/app/api/teams/route';
import { ApiErrorCode } from '@/domain/enums/ApiErrorCode';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { type ApiErrorBody } from '@/domain/types/api/ApiErrorBody';
import { type CalendarMonthResponse } from '@/domain/types/api/CalendarMonthResponse';
import { type CalendarSummaryResponse } from '@/domain/types/api/CalendarSummaryResponse';
import { type ExportDataResponse } from '@/domain/types/api/ExportDataResponse';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShareSettingsResponse } from '@/domain/types/api/ShareSettingsResponse';
import { teamInvites, teamMembers, teamRosters, teams } from '@/server/db/Schema';
import {
  type ApiTestClient,
  createApiTestClient,
  type IntegrationEnvironment,
  readJson,
  setupIntegrationEnvironment,
  type TestRouteHandler,
} from '../helpers/ApiTestClient';
import { createEnvSandbox } from '../helpers/EnvSandbox';
import { createLoggedInJob } from '../helpers/OffnalFlows';
import { findRowKey } from '../helpers/TeamRosterAssertions';
import {
  createInvite,
  getInviteRows,
  listMembers,
  listTeams,
  loggedInClient,
  lookupInvite,
  requestJoin,
} from '../helpers/TeamFlows';
import {
  ackChanges,
  extractNext,
  getMyMonths,
  getRosterView,
  joinAndApprove,
  publishRoster,
  type PublishedTeam,
  revertRoster,
  setupPublishedTeam,
  TEAM_MONTH,
  uploadRoster,
} from '../helpers/TeamRosterFlows';

/** Spec §24: TEAM_MODE=coming_soon closes every team API; months a team already published stay readable. */

const TEAM_API_DIRS = ['src/app/api/teams', 'src/app/api/invites'];
const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

let env: IntegrationEnvironment;
let team: PublishedTeam;
let member: ApiTestClient;
let memberUserId: string;
const envSandbox = createEnvSandbox();

beforeAll(async () => {
  env = await setupIntegrationEnvironment();
  // Built while team sharing is still enabled: a published team month with one approved member.
  team = await setupPublishedTeam('준비 관리자', '준비 병동');
  ({ member, userId: memberUserId } = await joinAndApprove(
    env.db,
    team,
    '준비 팀원',
    findRowKey(team.roster, '이여름'),
  ));
});

afterEach(() => {
  envSandbox.restore();
});

afterAll(async () => {
  await env.close();
});

const enableComingSoon = (): void => {
  envSandbox.set({ TEAM_MODE: 'coming_soon' });
};

const expectNotFound = async (response: Response): Promise<void> => {
  expect(response.status).toBe(404);
  expect((await readJson<ApiErrorBody>(response)).error.code).toBe(ApiErrorCode.NOT_FOUND);
};

const countTeamRows = async (): Promise<number[]> => [
  (await env.db.select().from(teams)).length,
  (await env.db.select().from(teamMembers)).length,
  (await env.db.select().from(teamRosters)).length,
  (await env.db.select().from(teamInvites)).length,
];

const findRouteFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name === 'route.ts')
    .map((entry) => path.join(entry.parentPath, entry.name));
};

describe('team coming soon mode', () => {
  it('answers 404 on every handler under /api/teams and /api/invites', async () => {
    enableComingSoon();

    // Real ids of an existing team: without the guard most handlers would answer 200 or 400, not 404.
    const params = {
      id: team.teamId,
      rosterId: team.rosterId,
      userId: memberUserId,
      inviteId: '00000000-0000-4000-8000-000000000003',
      yearMonth: TEAM_MONTH,
      token: team.token,
    };
    const files = (await Promise.all(TEAM_API_DIRS.map(findRouteFiles))).flat();
    let handlerCount = 0;

    expect(files.length).toBeGreaterThanOrEqual(20);

    for (const file of files) {
      const routeModule = (await import(path.resolve(file))) as Record<string, unknown>;

      for (const method of HTTP_METHODS) {
        const handler = routeModule[method] as TestRouteHandler<typeof params> | undefined;

        if (!handler) {
          continue;
        }

        handlerCount += 1;

        const response = await team.admin.send(handler, '/api/teams/placeholder', {
          method,
          ...(method === 'GET' || method === 'DELETE' ? {} : { json: {} }),
          params,
        });

        expect(response.status, `${method} ${file}`).toBe(404);
      }
    }

    expect(handlerCount).toBeGreaterThanOrEqual(29);
  });

  it('closes the representative team and invite routes without touching team data', async () => {
    const before = await countTeamRows();

    enableComingSoon();

    const outsider = await loggedInClient('준비 방문자');

    await expectNotFound(await listTeams(team.admin));
    await expectNotFound(await team.admin.send(createTeamRoute, '/api/teams', { json: { name: '새 팀' } }));
    await expectNotFound(await createInvite(team.admin, team.teamId));
    await expectNotFound(await lookupInvite(createApiTestClient(), team.token));
    await expectNotFound(await getInviteRows(outsider, team.token));
    await expectNotFound(await requestJoin(outsider, team.token, null));
    await expectNotFound(await uploadRoster(team.admin, team.teamId));
    await expectNotFound(await extractNext(team.admin, team.teamId, team.rosterId));
    await expectNotFound(await publishRoster(team.admin, team.teamId, team.rosterId, 1));
    await expectNotFound(await revertRoster(team.admin, team.teamId, team.rosterId));
    await expectNotFound(await listMembers(team.admin, team.teamId));
    await expectNotFound(await getMyMonths(member, team.teamId));
    await expectNotFound(await getRosterView(member, team.teamId, TEAM_MONTH));
    await expectNotFound(await ackChanges(member, team.teamId, { yearMonth: TEAM_MONTH, revision: 1 }));
    // The 404 comes before the origin check: a cross-site request learns nothing either.
    await expectNotFound(await uploadRoster(team.admin, team.teamId, { origin: 'https://evil.example' }));

    // A personal upload still works and never creates team data.
    await createLoggedInJob(createApiTestClient(), '준비 개인');

    expect(await countTeamRows()).toEqual(before);
  });

  it('keeps a published team month readable in the member calendar and ICS', async () => {
    enableComingSoon();

    const summaryResponse = await member.send(calendarRoute, '/api/calendar');

    expect(summaryResponse.status).toBe(200);
    expect(
      (await readJson<CalendarSummaryResponse>(summaryResponse)).months.map((month) => month.yearMonth),
    ).toContain(TEAM_MONTH);

    const monthResponse = await member.send(getMonthRoute, `/api/calendar/${TEAM_MONTH}`, {
      params: { yearMonth: TEAM_MONTH },
    });

    expect(monthResponse.status).toBe(200);

    const month = await readJson<CalendarMonthResponse>(monthResponse);

    expect(month.source).toBe(CalendarMonthSource.TEAM);
    expect(month.readOnly).toBe(true);
    expect(month.team?.teamName).toBe('준비 병동');

    const icsResponse = await member.send(exportIcsRoute, `/api/calendar/${TEAM_MONTH}/export.ics`, {
      params: { yearMonth: TEAM_MONTH },
    });

    expect(icsResponse.status).toBe(200);
    expect(await icsResponse.text()).toContain('BEGIN:VCALENDAR');

    // PNG export data of the team month.
    const exportResponse = await member.send(exportDataRoute, `/api/calendar/${TEAM_MONTH}/export-data`, {
      params: { yearMonth: TEAM_MONTH },
    });

    expect(exportResponse.status).toBe(200);
    expect((await readJson<ExportDataResponse>(exportResponse)).yearMonth).toBe(TEAM_MONTH);

    // Shared link: the team month stays visible to recipients.
    const shareResponse = await member.send(updateShareRoute, '/api/calendar/share', {
      json: { displayName: '이여름', visibleMonths: [TEAM_MONTH] },
    });

    expect(shareResponse.status).toBe(200);

    const settings = await readJson<ShareSettingsResponse>(shareResponse);
    const token = new URL(settings.url ?? '').pathname.slice('/s/'.length);
    const sharedResponse = await createApiTestClient().send(
      sharedRoute,
      `/api/shared/${token}?month=${TEAM_MONTH}`,
      {
        params: { token },
        origin: null,
      },
    );

    expect(sharedResponse.status).toBe(200);

    const shared = await readJson<SharedCalendarResponse>(sharedResponse);

    expect(shared.months).toContain(TEAM_MONTH);
    expect(shared.month?.yearMonth).toBe(TEAM_MONTH);
  });

  it('serves the team routes again once enabled', async () => {
    envSandbox.set({ TEAM_MODE: 'enabled' });

    expect((await listTeams(team.admin)).status).toBe(200);
    expect((await getMyMonths(member, team.teamId)).status).toBe(200);
  });
});
