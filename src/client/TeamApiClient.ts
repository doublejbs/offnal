import { encode, getJson, requestJson, sendJson } from '@/client/ApiClient';
import { type AckTeamChangesRequest } from '@/domain/types/api/AckTeamChangesRequest';
import { type AckTeamChangesResponse } from '@/domain/types/api/AckTeamChangesResponse';
import { type ApproveTeamMemberRequest } from '@/domain/types/api/ApproveTeamMemberRequest';
import { type CreateRosterDraftResponse } from '@/domain/types/api/CreateRosterDraftResponse';
import { type CreateTeamInviteRequest } from '@/domain/types/api/CreateTeamInviteRequest';
import { type CreateTeamInviteResponse } from '@/domain/types/api/CreateTeamInviteResponse';
import { type CreateTeamRequest } from '@/domain/types/api/CreateTeamRequest';
import { type CreateTeamRosterResponse } from '@/domain/types/api/CreateTeamRosterResponse';
import { type ExtractNextRequest } from '@/domain/types/api/ExtractNextRequest';
import { type ExtractNextResponse } from '@/domain/types/api/ExtractNextResponse';
import { type InviteLookupResponse } from '@/domain/types/api/InviteLookupResponse';
import { type InviteRowsResponse } from '@/domain/types/api/InviteRowsResponse';
import { type JoinTeamRequest } from '@/domain/types/api/JoinTeamRequest';
import { type OkResponse } from '@/domain/types/api/OkResponse';
import { type PatchTeamRosterRequest } from '@/domain/types/api/PatchTeamRosterRequest';
import { type PublishTeamRosterRequest } from '@/domain/types/api/PublishTeamRosterRequest';
import { type PublishTeamRosterResponse } from '@/domain/types/api/PublishTeamRosterResponse';
import { type RevertTeamRosterRequest } from '@/domain/types/api/RevertTeamRosterRequest';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { type TeamInviteListResponse } from '@/domain/types/api/TeamInviteListResponse';
import { type TeamListResponse } from '@/domain/types/api/TeamListResponse';
import { type TeamMemberDto } from '@/domain/types/api/TeamMemberDto';
import { type TeamMemberListResponse } from '@/domain/types/api/TeamMemberListResponse';
import { type TeamMembershipSummary } from '@/domain/types/api/TeamMembershipSummary';
import { type TeamMyMonthsResponse } from '@/domain/types/api/TeamMyMonthsResponse';
import { type TeamRosterListResponse } from '@/domain/types/api/TeamRosterListResponse';
import { type TeamRosterResponse } from '@/domain/types/api/TeamRosterResponse';
import { type TeamRosterViewResponse } from '@/domain/types/api/TeamRosterViewResponse';
import { type UpdateTeamMemberRequest } from '@/domain/types/api/UpdateTeamMemberRequest';
import { type UpdateTeamRequest } from '@/domain/types/api/UpdateTeamRequest';

/** Typed helpers for every team endpoint (docs/TeamShareSpec.md §15.1). Errors are ApiClientError. */

const teamPath = (teamId: string): string => `/api/teams/${encode(teamId)}`;

const rosterPath = (teamId: string, rosterId: string): string =>
  `${teamPath(teamId)}/rosters/${encode(rosterId)}`;

const invitePath = (token: string): string => `/api/invites/${encode(token)}`;

// Teams
export const listTeams = (signal?: AbortSignal): Promise<TeamListResponse> => getJson('/api/teams', signal);

export const createTeam = (body: CreateTeamRequest): Promise<TeamDetailResponse> =>
  sendJson('POST', '/api/teams', body);

export const getTeam = (teamId: string, signal?: AbortSignal): Promise<TeamDetailResponse> =>
  getJson(teamPath(teamId), signal);

export const updateTeam = (teamId: string, body: UpdateTeamRequest): Promise<TeamDetailResponse> =>
  sendJson('PATCH', teamPath(teamId), body);

export const deleteTeam = (teamId: string): Promise<OkResponse> => sendJson('DELETE', teamPath(teamId));

export const leaveTeam = (teamId: string): Promise<OkResponse> =>
  sendJson('DELETE', `${teamPath(teamId)}/membership`);

// Invites
export const listTeamInvites = (teamId: string, signal?: AbortSignal): Promise<TeamInviteListResponse> =>
  getJson(`${teamPath(teamId)}/invites`, signal);

export const createTeamInvite = (
  teamId: string,
  body: CreateTeamInviteRequest = {},
): Promise<CreateTeamInviteResponse> => sendJson('POST', `${teamPath(teamId)}/invites`, body);

export const revokeTeamInvite = (teamId: string, inviteId: string): Promise<OkResponse> =>
  sendJson('DELETE', `${teamPath(teamId)}/invites/${encode(inviteId)}`);

export const lookupInvite = (token: string, signal?: AbortSignal): Promise<InviteLookupResponse> =>
  getJson(invitePath(token), signal);

export const getInviteRows = (token: string, signal?: AbortSignal): Promise<InviteRowsResponse> =>
  getJson(`${invitePath(token)}/rows`, signal);

export const joinTeam = (token: string, body: JoinTeamRequest): Promise<TeamMembershipSummary> =>
  sendJson('POST', `${invitePath(token)}/join`, body);

// Members
export const listTeamMembers = (teamId: string, signal?: AbortSignal): Promise<TeamMemberListResponse> =>
  getJson(`${teamPath(teamId)}/members`, signal);

export const approveTeamMember = (
  teamId: string,
  userId: string,
  body: ApproveTeamMemberRequest = {},
): Promise<TeamMemberDto> => sendJson('POST', `${teamPath(teamId)}/members/${encode(userId)}/approve`, body);

export const rejectTeamMember = (teamId: string, userId: string): Promise<OkResponse> =>
  sendJson('POST', `${teamPath(teamId)}/members/${encode(userId)}/reject`);

export const updateTeamMember = (
  teamId: string,
  userId: string,
  body: UpdateTeamMemberRequest,
): Promise<TeamMemberDto> => sendJson('PATCH', `${teamPath(teamId)}/members/${encode(userId)}`, body);

export const removeTeamMember = (teamId: string, userId: string): Promise<OkResponse> =>
  sendJson('DELETE', `${teamPath(teamId)}/members/${encode(userId)}`);

// Rosters (admin)
export const listTeamRosters = (teamId: string, signal?: AbortSignal): Promise<TeamRosterListResponse> =>
  getJson(`${teamPath(teamId)}/rosters`, signal);

export type RosterUploadInput = {
  file: Blob;
  filename: string;
  authorityConfirmed: boolean;
  /** YYYY-MM; omitted = recognized from the photo. */
  yearMonth: string | null;
};

export const uploadTeamRoster = (
  teamId: string,
  input: RosterUploadInput,
): Promise<CreateTeamRosterResponse> => {
  const form = new FormData();

  form.append('file', input.file, input.filename);
  form.append('authorityConfirmed', input.authorityConfirmed ? 'true' : 'false');

  if (input.yearMonth) {
    form.append('yearMonth', input.yearMonth);
  }

  return requestJson(`${teamPath(teamId)}/rosters`, { method: 'POST', body: form });
};

export const getTeamRoster = (
  teamId: string,
  rosterId: string,
  signal?: AbortSignal,
): Promise<TeamRosterResponse> => getJson(rosterPath(teamId, rosterId), signal);

export const patchTeamRoster = (
  teamId: string,
  rosterId: string,
  body: PatchTeamRosterRequest,
): Promise<TeamRosterResponse> => sendJson('PATCH', rosterPath(teamId, rosterId), body);

export const extractNextRows = (
  teamId: string,
  rosterId: string,
  body: ExtractNextRequest = {},
): Promise<ExtractNextResponse> => sendJson('POST', `${rosterPath(teamId, rosterId)}/extract-next`, body);

export const publishTeamRoster = (
  teamId: string,
  rosterId: string,
  body: PublishTeamRosterRequest,
): Promise<PublishTeamRosterResponse> => sendJson('POST', `${rosterPath(teamId, rosterId)}/publish`, body);

export const createRosterDraft = (teamId: string, rosterId: string): Promise<CreateRosterDraftResponse> =>
  sendJson('POST', `${rosterPath(teamId, rosterId)}/draft`);

export const revertTeamRoster = (
  teamId: string,
  rosterId: string,
  body: RevertTeamRosterRequest = {},
): Promise<PublishTeamRosterResponse> => sendJson('POST', `${rosterPath(teamId, rosterId)}/revert`, body);

export const getRosterSourceUrl = (teamId: string, rosterId: string): string =>
  `${rosterPath(teamId, rosterId)}/source`;

// Members' views
export const getMyTeamMonths = (teamId: string, signal?: AbortSignal): Promise<TeamMyMonthsResponse> =>
  getJson(`${teamPath(teamId)}/my-months`, signal);

export const getTeamRosterView = (
  teamId: string,
  yearMonth: string,
  signal?: AbortSignal,
): Promise<TeamRosterViewResponse> => getJson(`${teamPath(teamId)}/roster/${encode(yearMonth)}`, signal);

export const ackTeamChanges = (
  teamId: string,
  body: AckTeamChangesRequest,
): Promise<AckTeamChangesResponse> => sendJson('POST', `${teamPath(teamId)}/acks`, body);
