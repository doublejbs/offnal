import MonthCheckout from '@/components/checkout/MonthCheckout';

type CheckoutPageProps = {
  params: Promise<{ yearMonth: string }>;
  searchParams: Promise<{ draftId?: string }>;
};

const CheckoutPage = async ({ params, searchParams }: CheckoutPageProps) => {
  const { yearMonth } = await params;
  const { draftId } = await searchParams;

  return <MonthCheckout yearMonth={yearMonth} draftId={draftId ?? null} />;
};

export default CheckoutPage;
