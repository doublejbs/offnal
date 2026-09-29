'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSharedCalendar } from '@/client/ApiClient';
import { formatDateTime } from '@/client/DisplayText';
import DayDetail from '@/components/calendar/DayDetail';
import MonthGrid from '@/components/calendar/MonthGrid';
import MonthHeading from '@/components/calendar/MonthHeading';
import MonthSwitcher from '@/components/calendar/MonthSwitcher';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import { useLoad } from '@/components/UseLoad';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { type SharedCalendarResponse } from '@/domain/types/api/SharedCalendarResponse';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

type SharedCalendarViewProps = {
  token: string;
  month: string | null;
};

const INVALID_MESSAGE = '링크가 만료되었거나 공유가 중지되었어요.';

/** Shared entries carry codes only; they are shown as confirmed read-only days. */
const toEntries = (data: SharedCalendarResponse): ShiftEntry[] =>
  (data.month?.entries ?? []).map((entry) => ({
    date: entry.date,
    code: entry.code,
    reviewReasons: [],
    confirmed: entry.code !== null,
  }));

/** Public read-only calendar: display name, visible months only, no edit UI, no source, no other people. */
const SharedCalendarView = ({ token, month }: SharedCalendarViewProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const shared = useLoad(`${token}:${month ?? ''}`, (signal) => getSharedCalendar(token, month, signal));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data } = shared;

  if (shared.state === ScreenLoadState.LOADING) {
    return <LoadingState text="달력을 불러오는 중이에요…" />;
  }

  // Only a 404 means the link itself is invalid; anything else is a temporary failure worth retrying.
  if (shared.state === ScreenLoadState.NOT_FOUND) {
    return (
      <EmptyState
        label="함께 보는 근무표"
        title={INVALID_MESSAGE}
        description="링크를 보낸 사람에게 새 링크를 요청해 주세요."
      />
    );
  }

  if (shared.state !== ScreenLoadState.READY || !data) {
    return (
      <RecoverableError
        title="달력을 불러오지 못했어요"
        message={shared.errorMessage ?? '잠시 후 다시 시도해 주세요.'}
        onRetry={shared.reload}
      />
    );
  }

  if (!data.month) {
    return (
      <EmptyState
        label="함께 보는 근무표"
        title="아직 공개된 달이 없어요"
        description={`${data.displayName}님이 공개한 달이 생기면 여기에서 볼 수 있어요.`}
      />
    );
  }

  const entries = toEntries(data);
  const selectedEntry = entries.find((entry) => entry.date === selectedDate);

  const handleChangeMonth = (next: string) => {
    setSelectedDate(null);
    router.replace(`${pathname}?month=${next}`);
  };

  return (
    <>
      <div className="label">함께 보는 근무표</div>
      <MonthHeading
        displayName={data.displayName}
        yearMonth={data.month.yearMonth}
        entries={entries}
        definitions={data.month.definitions}
      />
      <MonthSwitcher months={data.months} current={data.month.yearMonth} onChange={handleChangeMonth} />
      <div className="mt-12">
        <MonthGrid
          yearMonth={data.month.yearMonth}
          entries={entries}
          definitions={data.month.definitions}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </div>
      {selectedEntry && (
        <DayDetail date={selectedEntry.date} code={selectedEntry.code} definitions={data.month.definitions} />
      )}
      <div className="hint">
        최종 수정 {formatDateTime(data.month.updatedAt)}
        <br />
        공유받은 달력은 읽기 전용이에요.
      </div>
    </>
  );
};

export default SharedCalendarView;
