import { type PublishBlocker } from '@/domain/types/PublishBlocker';

/** A non-excluded row that blocks publishing (`details.blockers` of 422 PUBLISH_BLOCKED). */
export type TeamRosterRowBlocker = {
  rowId: string;
  rowKey: string;
  displayName: string;
  blockers: PublishBlocker[];
};
