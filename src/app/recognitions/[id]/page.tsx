import RecognitionScreen from '@/components/recognition/RecognitionScreen';

type RecognitionPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ login?: string }>;
};

const RecognitionPage = async ({ params, searchParams }: RecognitionPageProps) => {
  const { id } = await params;
  const { login } = await searchParams;

  return <RecognitionScreen id={id} loginFailed={login === 'failed'} />;
};

export default RecognitionPage;
