import TeamDetailView from '@/components/team/TeamDetailView';

type TeamPageProps = {
  params: Promise<{ id: string }>;
};

const TeamPage = async ({ params }: TeamPageProps) => {
  const { id } = await params;

  return <TeamDetailView key={id} teamId={id} />;
};

export default TeamPage;
