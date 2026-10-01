import { type TeamInviteDto } from '@/domain/types/api/TeamInviteDto';

/** GET /api/teams/:id/invites (ADMIN) — newest first, revoked/expired ones included. */
export type TeamInviteListResponse = {
  invites: TeamInviteDto[];
};
