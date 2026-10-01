import TeamRosterReadView from '@/components/roster/TeamRosterReadView';

type TeamRosterPageProps = {
  params: Promise<{ id: string; yearMonth: string }>;
};

const TeamRosterPage = async ({ params }: TeamRosterPageProps) => {
  const { id, yearMonth } = await params;

  return <TeamRosterReadView key={`${id}-${yearMonth}`} teamId={id} yearMonth={yearMonth} />;
};

export default TeamRosterPage;
