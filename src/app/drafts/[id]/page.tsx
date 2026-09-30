import DraftReviewView from '@/components/draft/DraftReviewView';

type DraftPageProps = {
  params: Promise<{ id: string }>;
};

const DraftPage = async ({ params }: DraftPageProps) => {
  const { id } = await params;

  return <DraftReviewView draftId={id} />;
};

export default DraftPage;
