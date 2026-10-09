import { TeamMode } from '@/domain/enums/TeamMode';

/** Team sharing is shown as "준비 중" and every team API is 404 (Spec §24). Pure, so client-safe callers may use it. */
export const isTeamComingSoon = (config: { teamMode: TeamMode }): boolean =>
  config.teamMode === TeamMode.COMING_SOON;
