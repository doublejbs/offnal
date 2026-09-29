import CalendarMonthView from '@/components/calendar/CalendarMonthView';

type CalendarMonthPageProps = {
  params: Promise<{ yearMonth: string }>;
};

const CalendarMonthPage = async ({ params }: CalendarMonthPageProps) => {
  const { yearMonth } = await params;

  return <CalendarMonthView key={yearMonth} yearMonth={yearMonth} />;
};

export default CalendarMonthPage;
