import ExportSheet from '@/components/share/ExportSheet';

type SharePageProps = {
  params: Promise<{ yearMonth: string }>;
};

const SharePage = async ({ params }: SharePageProps) => {
  const { yearMonth } = await params;

  return <ExportSheet yearMonth={yearMonth} />;
};

export default SharePage;
