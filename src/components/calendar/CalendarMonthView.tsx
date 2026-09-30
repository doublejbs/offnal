'use client';

import Link from 'next/link';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import AuthRequired from '@/components/AuthRequired';
import DayDetail from '@/components/calendar/DayDetail';
import MonthGrid from '@/components/calendar/MonthGrid';
import MonthHeading from '@/components/calendar/MonthHeading';
import MonthSwitcher from '@/components/calendar/MonthSwitcher';
import { useCalendarMonthState } from '@/components/calendar/UseCalendarMonthState';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type CalendarMonthViewProps = {
  yearMonth: string;
};

const CalendarMonthView = ({ yearMonth }: CalendarMonthViewProps) => {
  const state = useCalendarMonthState(yearMonth);
  const { summary, month } = state;

  if (state.loadState === ScreenLoadState.LOADING) {
    return <LoadingState text="달력을 불러오는 중이에요…" />;
  }

  if (state.loadState === ScreenLoadState.AUTH_REQUIRED) {
    return (
      <AuthRequired
        returnTo={`/calendar/${yearMonth}`}
        description="로그인하면 저장한 달력을 볼 수 있어요."
      />
    );
  }

  if (state.loadState === ScreenLoadState.NOT_FOUND) {
    const latest = summary?.months.at(-1)?.yearMonth;

    return (
      <EmptyState
        label="내 달력"
        title="이 달은 저장된 달력이 없어요"
        description="근무표를 올려 이 달의 달력을 만들어 보세요."
      >
        <Link href="/upload" className="primary">
          근무표 올리기
        </Link>
        {latest && (
          <Link href={`/calendar/${latest}`} className="secondary">
            저장한 달력 보기
          </Link>
        )}
      </EmptyState>
    );
  }

  if (state.loadState !== ScreenLoadState.READY || !summary || !month) {
    return (
      <RecoverableError
        title="달력을 불러오지 못했어요"
        message={state.loadError ?? '다시 시도해 주세요.'}
        onRetry={state.handleReload}
      />
    );
  }

  const selectedEntry = month.entries.find((entry) => entry.date === state.selectedDate);
  const showShareBanner = summary.share.enabled && !month.shareVisible;

  return (
    <>
      <div className="label">내 달력</div>
      <MonthHeading
        displayName={month.displayName}
        yearMonth={month.yearMonth}
        entries={month.entries}
        definitions={month.definitions}
      />
      <MonthSwitcher
        months={summary.months.map((item) => item.yearMonth)}
        current={yearMonth}
        onChange={state.handleChangeMonth}
      />
      {showShareBanner && (
        <div className="notice">
          공유 링크에 이 달을 공개할까요? 지금은 링크를 받은 사람에게 이 달이 보이지 않아요.
          <button
            type="button"
            className="secondary mt-10"
            onClick={state.handleShareThisMonth}
            disabled={state.isSharingMonth}
          >
            {state.isSharingMonth ? '공개하는 중…' : '이 달도 공유 링크에 공개'}
          </button>
        </div>
      )}
      <div className="mt-12">
        <MonthGrid
          yearMonth={month.yearMonth}
          entries={month.entries}
          definitions={month.definitions}
          selectedDate={state.selectedDate}
          onSelectDate={state.setSelectedDate}
        />
      </div>
      {selectedEntry && (
        <DayDetail date={selectedEntry.date} code={selectedEntry.code} definitions={month.definitions} />
      )}
      {state.actionError && (
        <div className="warning" role="alert">
          {state.actionError}
        </div>
      )}
      <div className="stack mt-16">
        <Link href={`/calendar/${yearMonth}/share`} className="primary">
          공유·내보내기
        </Link>
      </div>
      <div className="actionrow">
        <button type="button" className="secondary" onClick={state.handleEdit} disabled={state.isEditing}>
          {state.isEditing ? '여는 중…' : '근무 수정'}
        </button>
        <Link href="/upload" className="secondary">
          다음 달 등록
        </Link>
      </div>
      <div className="hint">
        {summary.freeRemaining > 0
          ? `무료로 ${formatMonthCount(summary.freeRemaining)} 더 이용할 수 있어요.`
          : `새 달은 한 달분 ${formatPrice(summary.priceKrw)} · 자동 결제 없음`}
      </div>
      <div className="center">
        <button type="button" className="textbutton" onClick={() => state.setIsDeleteOpen(true)}>
          이 달 달력 삭제
        </button>
      </div>
      <ConfirmDialog
        isOpen={state.isDeleteOpen}
        title={`${formatYearMonthLabel(yearMonth)} 달력을 삭제할까요?`}
        message="달력과 공유 링크에서 이 달이 사라져요. 이미 사용한 무료 월이나 구매한 이용권은 그대로 남아서, 같은 달을 다시 등록해도 추가 비용이 없어요."
        confirmLabel="삭제"
        isDanger
        isBusy={state.isDeleting}
        onConfirm={state.handleDelete}
        onCancel={() => state.setIsDeleteOpen(false)}
      />
    </>
  );
};

export default CalendarMonthView;
