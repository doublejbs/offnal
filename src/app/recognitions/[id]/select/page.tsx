import PersonMonthSelector from '@/components/select/PersonMonthSelector';

type SelectPageProps = {
  params: Promise<{ id: string }>;
};

const SelectPage = async ({ params }: SelectPageProps) => {
  const { id } = await params;

  return <PersonMonthSelector recognitionId={id} />;
};

export default SelectPage;
