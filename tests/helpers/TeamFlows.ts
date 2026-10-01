import { expect } from 'vitest';

import { POST as joinRoute } from '@/app/api/invites/[token]/join/route';
import { GET as inviteRowsRoute } from '@/app/api/invites/[token]/rows/route';
import { GET as inviteLookupRoute } from '@/app/api/invites/[token]/route';
import { DELETE as revokeInviteRoute } from '@/app/api/teams/[id]/invites/[inviteId]/route';
import { GET as listInvitesRoute, POST as createInviteRoute } from '@/app/api/teams/[id]/invites/route';
import { POST as approveRoute } from '@/app/api/teams/[id]/members/[userId]/approve/route';
import { POST as rejectRoute } from '@/app/api/teams/[id]/members/[userId]/reject/route';
import {
  DELETE as removeMemberRoute,
  PATCH as updateMemberRoute,
} from '@/app/api/teams/[id]/members/[userId]/route';
import { GET as listMembersRoute } from '@/app/api/teams/[id]/members/route';
import { DELETE as leaveRoute } from '@/app/api/teams/[id]/membership/route';
import {
  DELETE as deleteTeamRoute,
  GET as getTeamRoute,
  PATCH as updateTeamRoute,
} from '@/app/api/teams/[id]/route';
import { GET as listTeamsRoute, POST as createTeamRoute } from '@/app/api/teams/route';
import { type CreateTeamInviteResponse } from '@/domain/types/api/CreateTeamInviteResponse';
import { type InviteRowsResponse } from '@/domain/types/api/InviteRowsResponse';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { type ApiTestClient, createApiTestClient, readJson } from './ApiTestClient';
import { devLogin } from './OffnalFlows';

/** Team, invite and membership API calls (rosters: TeamRosterFlows). */
export const loggedInClient = async (displayName: string): Promise<ApiTestClient> => {
  const client = createApiTestClient();

  expect((await devLogin(client, displayName)).status).toBe(303);

  return client;
};

export const createTeam = async (client: ApiTestClient, name: string): Promise<TeamDetailResponse> => {
  const response = await client.send(createTeamRoute, '/api/teams', { json: { name } });

  expect(response.status).toBe(201);

  return readJson<TeamDetailResponse>(response);
};

export const listTeams = (client: ApiTestClient): Promise<Response> =>
  client.send(listTeamsRoute, '/api/teams');

export const getTeam = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(getTeamRoute, `/api/teams/${teamId}`, { params: { id: teamId } });

export const updateTeam = (client: ApiTestClient, teamId: string, body: unknown): Promise<Response> =>
  client.send(updateTeamRoute, `/api/teams/${teamId}`, {
    method: 'PATCH',
    json: body,
    params: { id: teamId },
  });

export const deleteTeam = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(deleteTeamRoute, `/api/teams/${teamId}`, { method: 'DELETE', params: { id: teamId } });

export const createInvite = (client: ApiTestClient, teamId: string, body: unknown = {}): Promise<Response> =>
  client.send(createInviteRoute, `/api/teams/${teamId}/invites`, { json: body, params: { id: teamId } });

export const issueInvite = async (
  client: ApiTestClient,
  teamId: string,
): Promise<CreateTeamInviteResponse> => {
  const response = await createInvite(client, teamId);

  expect(response.status).toBe(201);

  return readJson<CreateTeamInviteResponse>(response);
};

export const listInvites = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(listInvitesRoute, `/api/teams/${teamId}/invites`, { params: { id: teamId } });

export const revokeInvite = (client: ApiTestClient, teamId: string, inviteId: string): Promise<Response> =>
  client.send(revokeInviteRoute, `/api/teams/${teamId}/invites/${inviteId}`, {
    method: 'DELETE',
    params: { id: teamId, inviteId },
  });

export const lookupInvite = (client: ApiTestClient, token: string): Promise<Response> =>
  client.send(inviteLookupRoute, `/api/invites/${token}`, { params: { token } });

export const getInviteRows = (client: ApiTestClient, token: string): Promise<Response> =>
  client.send(inviteRowsRoute, `/api/invites/${token}/rows`, { params: { token } });

export const readInviteRows = async (client: ApiTestClient, token: string): Promise<InviteRowsResponse> => {
  const response = await getInviteRows(client, token);

  expect(response.status).toBe(200);

  return readJson<InviteRowsResponse>(response);
};

export const requestJoin = (client: ApiTestClient, token: string, rowKey: string | null): Promise<Response> =>
  client.send(joinRoute, `/api/invites/${token}/join`, { json: { rowKey }, params: { token } });

export const listMembers = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(listMembersRoute, `/api/teams/${teamId}/members`, { params: { id: teamId } });

export const approveMember = (
  client: ApiTestClient,
  teamId: string,
  userId: string,
  body: unknown = {},
): Promise<Response> =>
  client.send(approveRoute, `/api/teams/${teamId}/members/${userId}/approve`, {
    json: body,
    params: { id: teamId, userId },
  });

export const rejectMember = (client: ApiTestClient, teamId: string, userId: string): Promise<Response> =>
  client.send(rejectRoute, `/api/teams/${teamId}/members/${userId}/reject`, {
    method: 'POST',
    params: { id: teamId, userId },
  });

export const updateMember = (
  client: ApiTestClient,
  teamId: string,
  userId: string,
  body: unknown,
): Promise<Response> =>
  client.send(updateMemberRoute, `/api/teams/${teamId}/members/${userId}`, {
    method: 'PATCH',
    json: body,
    params: { id: teamId, userId },
  });

export const removeMember = (client: ApiTestClient, teamId: string, userId: string): Promise<Response> =>
  client.send(removeMemberRoute, `/api/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
    params: { id: teamId, userId },
  });

export const leaveTeam = (client: ApiTestClient, teamId: string): Promise<Response> =>
  client.send(leaveRoute, `/api/teams/${teamId}/membership`, { method: 'DELETE', params: { id: teamId } });
