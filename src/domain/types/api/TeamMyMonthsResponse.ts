import { type TeamMyMonthDto } from '@/domain/types/api/TeamMyMonthDto';

/** GET /api/teams/:id/my-months — ACTIVE members (admins included) only; others 404. */
export type TeamMyMonthsResponse = {
  team: { id: string; name: string };
  /** Linked row key, null when not linked yet (then `months` is empty). */
  linkedRowKey: string | null;
  /** Months where the linked row exists in the latest published revision, ascending. */
  months: TeamMyMonthDto[];
};
