import { type TeamMemberStatus } from '@/domain/enums/TeamMemberStatus';
import { type TeamRole } from '@/domain/enums/TeamRole';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';

/** A member or join request as the admin sees it. */
export type TeamMemberDto = {
  userId: string;
  /** Account display name (Kakao nickname). */
  displayName: string;
  role: TeamRole;
  /** PENDING or ACTIVE. */
  status: TeamMemberStatus;
  /** Linked row (requested row while PENDING). */
  linkedRowKey: string | null;
  /** That row in the latest published roster (name, ordinal, first 3 codes); null if not found there. */
  linkedRow: JoinableRowDto | null;
  /** ISO 8601 */
  requestedAt: string;
  /** ISO 8601 */
  approvedAt: string | null;
  isMe: boolean;
};
