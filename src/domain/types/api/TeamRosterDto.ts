import { type TeamRosterStatus } from '@/domain/enums/TeamRosterStatus';

/** Roster header (admin views). */
export type TeamRosterDto = {
  id: string;
  teamId: string;
  /** YYYY-MM; null only until the first pass of an upload finished. */
  yearMonth: string | null;
  status: TeamRosterStatus;
  /** Published revision (null while DRAFT). */
  revision: number | null;
  /** Published revision this draft is based on (0 = none). Publishing is refused once a newer one exists. */
  baseRevision: number;
  /** Optimistic-lock counter: send it with PATCH/publish (409 when stale). */
  version: number;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  publishedAt: string | null;
  /** ISO 8601 — the uploader's "이 근무표를 팀에 공유할 권한이 있어요" consent. */
  authorityConfirmedAt: string | null;
  /**
   * Created by a photo upload (not a copy of a published revision). Its times were read from a photo and must be
   * confirmed before publishing, even after the photo itself expired.
   */
  fromUpload: boolean;
  /** True while the original photo can be fetched from GET .../rosters/:rid/source. */
  sourceAvailable: boolean;
};
