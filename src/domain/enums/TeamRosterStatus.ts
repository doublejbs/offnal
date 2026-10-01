/** One revision of a team's month roster. Only one PUBLISHED roster per team and month at a time. */
export enum TeamRosterStatus {
  /** Being recognized / reviewed by an admin. Never visible to members. */
  DRAFT = 'draft',
  /** The latest published revision of the month: what members see. */
  PUBLISHED = 'published',
  /** A previously published revision replaced by a newer one (kept for diffs and revert). */
  ARCHIVED = 'archived',
}
