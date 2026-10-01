import RosterEditorScreen from '@/components/roster/RosterEditorScreen';

type RosterPageProps = {
  params: Promise<{ id: string; rosterId: string }>;
};

const RosterPage = async ({ params }: RosterPageProps) => {
  const { id, rosterId } = await params;

  return <RosterEditorScreen key={rosterId} teamId={id} rosterId={rosterId} />;
};

export default RosterPage;
