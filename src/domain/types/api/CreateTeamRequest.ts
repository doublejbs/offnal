/** POST /api/teams — creates a team; the caller becomes its first ADMIN. */
export type CreateTeamRequest = {
  /** 1–40 characters, e.g. "7병동 간호팀". */
  name: string;
};
