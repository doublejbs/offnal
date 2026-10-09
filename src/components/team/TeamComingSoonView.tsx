import Link from 'next/link';

import {
  TEAM_COMING_SOON_DESCRIPTION,
  TEAM_COMING_SOON_LABEL,
  TEAM_COMING_SOON_TITLE,
} from '@/client/TeamComingSoonCopy';
import EmptyState from '@/components/EmptyState';

type TeamComingSoonViewProps = {
  isLoggedIn: boolean;
};

/** `/teams/**` and `/join/**` in team "준비 중" mode (Spec §24.2): no team or invite lookup at all. */
const TeamComingSoonView = ({ isLoggedIn }: TeamComingSoonViewProps) => (
  <EmptyState
    label={TEAM_COMING_SOON_LABEL}
    title={TEAM_COMING_SOON_TITLE}
    description={TEAM_COMING_SOON_DESCRIPTION}
  >
    {isLoggedIn ? (
      <Link href="/calendar" className="primary">
        내 달력으로
      </Link>
    ) : (
      <Link href="/" className="primary">
        처음으로
      </Link>
    )}
  </EmptyState>
);

export default TeamComingSoonView;
