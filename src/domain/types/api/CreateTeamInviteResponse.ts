import { type TeamInviteDto } from '@/domain/types/api/TeamInviteDto';

/** POST /api/teams/:id/invites (201). `token`/`url` appear only here: copy or share them right away. */
export type CreateTeamInviteResponse = {
  invite: TeamInviteDto;
  /** 256-bit base64url token (only its hash is stored). */
  token: string;
  /** `${APP_URL}/join/${token}` */
  url: string;
};
