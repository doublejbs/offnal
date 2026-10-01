/** A team as shown to its active members and admins. */
export type TeamDto = {
  id: string;
  name: string;
  /** Active members may view the whole published roster (default true; admins can turn it off). */
  shareRosterWithMembers: boolean;
  /** ISO 8601 */
  createdAt: string;
};
