import { expect } from 'vitest';

import { POST as acksRoute } from '@/app/api/teams/[id]/acks/route';
import { GET as myMonthsRoute } from '@/app/api/teams/[id]/my-months/route';
import { GET as rosterViewRoute } from '@/app/api/teams/[id]/roster/[yearMonth]/route';
import { POST as createDraftRoute } from '@/app/api/teams/[id]/rosters/[rosterId]/draft/route';
import { POST as extractNextRoute } from '@/app/api/teams/[id]/rosters/[rosterId]/extract-next/route';
import { POST as publishRoute } from '@/app/api/teams/[id]/rosters/[rosterId]/publish/route';
import { POST as revertRoute } from '@/app/api/teams/[id]/rosters/[rosterId]/revert/route';
import {
  GET as getRosterRoute,
  PATCH as patchRosterRoute,
} from '@/app/api/teams/[id]/rosters/[rosterId]/route';
import { GET as listRostersRoute, POST as uploadRosterRoute } from '@/app/api/teams/[id]/rosters/route';
import { TeamRosterPhase } from '@/domain/enums/TeamRosterPhase';
import { type CreateTeamRosterResponse } from '@/domain/types/api/CreateTeamRosterResponse';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterRowPatch } from '@/domain/types/api/TeamRosterRowPatch';
import { type Db } from '@/server/db/Database';
import { MOCK_TEAM_TABLE_MIN_WIDTH } from '@/server/vision/MockVisionProvider';
import { type ApiTestClient, createPngFixture, readJson } from './ApiTestClient';
import { defineMockUndefinedCodes, resolveEntries } from './OffnalFlows';
import { findUserId } from './PaymentFlows';
import { approveMember, createTeam, issueInvite, loggedInClient, requestJoin } from './TeamFlows';

/** Roster, member-view and composite team setup calls. */
export const TEAM_MONTH = '2026-11';

/** 1600x900: the mock first pass returns the 10-person team fixture. */
export const createTeamTablePng = (): Promise<Buffer> => createPngFixture(MOCK_TEAM_TABLE_MIN_WIDTH, 900);

export type TestRouteParams = Record<string, string>;

export type RosterUploadOptions = {
  bytes?: Buffer;
  yearMonth?: string | null;
  authorityConfirmed?: boolean;
  origin?: string;
};

export const uploadRoster = async (
  client: ApiTestClient,
  teamId: string,
  options: RosterUploadOptions = {},
): Promise<Response> => {
  const form = new FormData();
  const bytes = options.bytes ?? (await createTeamTablePng());

  form.set('file', new File([new Uint8Array(bytes)], 'roster.png', { type: 'image/png' }));

  if (options.authorityConfirmed ?? true) {
    form.set('authorityConfirmed', 'true');
  }

  if (options.yearMonth !== null) {
    form.set('yearMonth', options.yearMonth ?? TEAM_MONTH);
  }

  return client.send(uploadRosterRoute, `/api/teams/${teamId}/rosters`, {
    method: 'POST',
    form,
    params: { id: teamId },
    ...(options.origin ? { origin: options.origin } : {}),
  });
};

export const createRoster = async (
  client: ApiTestClient,
  teamId: string,
  options: RosterUploadOptions = {},
): Promise<string> => {
  const response = await uploadRoster(client, teamId, options);

  expect(response.status).toBe(201);

  return (await readJson<CreateTeamRosterResponse>(response)).rosterId;
};

export const listRosters = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(listRostersRoute, `/api/teams/${teamId}/rosters`, { params: { id: teamId } });

export const extractNext = (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
  body: unknown = {},
): Promise<Response> =>
  client.send(extractNextRoute, `/api/teams/${teamId}/rosters/${rosterId}/extract-next`, {
    json: body,
    params: { id: teamId, rosterId },
  });

const MAX_EXTRACT_CALLS = 20;

/** Calls extract-next until nothing is waiting. Returns the last response. */
export const extractAll = async (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
): Promise<ExtractNextResponse> => {
  for (let call = 0; call < MAX_EXTRACT_CALLS; call += 1) {
    const response = await extractNext(client, teamId, rosterId);

    expect(response.status).toBe(200);

    const body = await readJson<ExtractNextResponse>(response);

    if (
      body.progress.phase === TeamRosterPhase.READY ||
      body.progress.phase === TeamRosterPhase.RECOGNITION_FAILED
    ) {
      return body;
    }
  }

  throw new Error('extraction did not finish');
};

export const getRoster = (client: ApiTestClient, teamId: string, rosterId: string): Promise<Response> =>
  client.send(getRosterRoute, `/api/teams/${teamId}/rosters/${rosterId}`, {
    params: { id: teamId, rosterId },
  });

export const readRoster = async (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
): Promise<TeamRosterResponse> => {
  const response = await getRoster(client, teamId, rosterId);

  expect(response.status).toBe(200);

  return readJson<TeamRosterResponse>(response);
};

export const patchRoster = (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
  body: unknown,
): Promise<Response> =>
  client.send(patchRosterRoute, `/api/teams/${teamId}/rosters/${rosterId}`, {
    method: 'PATCH',
    json: body,
    params: { id: teamId, rosterId },
  });

/** Resolves every review item of every row (like an admin would) and defines the mock's extra codes. */
export const resolveRoster = async (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
  rowEdits: (row: TeamRosterResponse['rows'][number]) => Partial<TeamRosterRowPatch> = () => ({}),
): Promise<TeamRosterResponse> => {
  const current = await readRoster(client, teamId, rosterId);
  const response = await patchRoster(client, teamId, rosterId, {
    version: current.roster.version,
    definitions: defineMockUndefinedCodes(current.definitions),
    rows: current.rows.map((row) => ({
      rowId: row.id,
      entries: resolveEntries(row.entries),
      ...rowEdits(row),
    })),
  });

  expect(response.status).toBe(200);

  return readJson<TeamRosterResponse>(response);
};

export const publishRoster = (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
  version: number,
): Promise<Response> =>
  client.send(publishRoute, `/api/teams/${teamId}/rosters/${rosterId}/publish`, {
    json: { version },
    params: { id: teamId, rosterId },
  });

export const publishReadyRoster = async (
  client: ApiTestClient,
  teamId: string,
  roster: TeamRosterResponse,
): Promise<PublishTeamRosterResponse> => {
  const response = await publishRoster(client, teamId, roster.roster.id, roster.roster.version);

  expect(response.status).toBe(200);

  return readJson<PublishTeamRosterResponse>(response);
};

export const revertRoster = (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
  body: unknown = {},
): Promise<Response> =>
  client.send(revertRoute, `/api/teams/${teamId}/rosters/${rosterId}/revert`, {
    json: body,
    params: { id: teamId, rosterId },
  });

export const createRosterDraft = (
  client: ApiTestClient,
  teamId: string,
  rosterId: string,
): Promise<Response> =>
  client.send(createDraftRoute, `/api/teams/${teamId}/rosters/${rosterId}/draft`, {
    method: 'POST',
    params: { id: teamId, rosterId },
  });

export const getMyMonths = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(myMonthsRoute, `/api/teams/${teamId}/my-months`, { params: { id: teamId } });

export const getRosterView = (client: ApiTestClient, teamId: string, yearMonth: string): Promise<Response> =>
  client.send(rosterViewRoute, `/api/teams/${teamId}/roster/${yearMonth}`, {
    params: { id: teamId, yearMonth },
  });

export const ackChanges = (client: ApiTestClient, teamId: string, body: unknown): Promise<Response> =>
  client.send(acksRoute, `/api/teams/${teamId}/acks`, { json: body, params: { id: teamId } });

/** Upload → extract everything → resolve → publish. Returns the published roster state before publishing. */
export const uploadAndPublishRoster = async (
  admin: ApiTestClient,
  teamId: string,
  options: RosterUploadOptions = {},
): Promise<{ rosterId: string; roster: TeamRosterResponse; published: PublishTeamRosterResponse }> => {
  const rosterId = await createRoster(admin, teamId, options);

  await extractAll(admin, teamId, rosterId);

  const roster = await resolveRoster(admin, teamId, rosterId);
  const published = await publishReadyRoster(admin, teamId, roster);

  return { rosterId, roster, published };
};

/** A team with its admin and an invite token. */
export type InvitedTeam = {
  admin: ApiTestClient;
  teamId: string;
  token: string;
};

export type PublishedTeam = InvitedTeam & {
  rosterId: string;
  roster: TeamRosterResponse;
};

/** Admin creates a team and issues an invite (no roster yet). */
export const setupInvitedTeam = async (adminName: string, teamName: string): Promise<InvitedTeam> => {
  const admin = await loggedInClient(adminName);
  const { team } = await createTeam(admin, teamName);
  const { token } = await issueInvite(admin, team.id);

  return { admin, teamId: team.id, token };
};

/** Admin creates a team, publishes the mock roster for TEAM_MONTH and issues an invite. */
export const setupPublishedTeam = async (adminName: string, teamName: string): Promise<PublishedTeam> => {
  const admin = await loggedInClient(adminName);
  const { team } = await createTeam(admin, teamName);
  const { rosterId, roster } = await uploadAndPublishRoster(admin, team.id);
  const { token } = await issueInvite(admin, team.id);

  return { admin, teamId: team.id, rosterId, roster, token };
};

/** A new user requests `rowKey` through the invite and the admin approves. Returns the member client. */
export const joinAndApprove = async (
  db: Db,
  team: InvitedTeam,
  memberName: string,
  rowKey: string | null,
): Promise<{ member: ApiTestClient; userId: string }> => {
  const member = await loggedInClient(memberName);

  expect((await requestJoin(member, team.token, rowKey)).status).toBe(200);

  const userId = await findUserId(db, memberName);

  expect((await approveMember(team.admin, team.teamId, userId)).status).toBe(200);

  return { member, userId };
};
