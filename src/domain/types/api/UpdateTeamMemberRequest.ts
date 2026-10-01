import { type TeamRole } from '@/domain/enums/TeamRole';

/** PATCH /api/teams/:id/members/:userId (ADMIN) — change the linked row and/or role of an ACTIVE member. */
export type UpdateTeamMemberRequest = {
  /** New linked row; null unlinks. One active member per row (409 ROW_TAKEN). */
  rowKey?: string | null;
  /** Promote/demote. Demoting the last admin → 409 LAST_ADMIN. */
  role?: TeamRole;
};
