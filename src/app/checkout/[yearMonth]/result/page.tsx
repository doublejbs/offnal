import CheckoutResultView from '@/components/checkout/CheckoutResultView';

type CheckoutResultPageProps = {
  params: Promise<{ yearMonth: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const readParam = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Provider redirect target (Toss successUrl/failUrl, or the mock buttons). */
const CheckoutResultPage = async ({ params, searchParams }: CheckoutResultPageProps) => {
  const { yearMonth } = await params;
  const query = await searchParams;
  const paymentKey = readParam(query.paymentKey);
  const isFailure =
    readParam(query.status) === 'fail' || (readParam(query.code) !== null && paymentKey === null);

  return (
    <CheckoutResultView
      query={{
        yearMonth,
        paymentKey,
        orderId: readParam(query.orderId),
        amount: readParam(query.amount),
        isFailure,
        draftId: readParam(query.draftId),
      }}
    />
  );
};

export default CheckoutResultPage;
