'use client';

import Link from 'next/link';

import AuthRequired from '@/components/AuthRequired';
import CalendarPersonalActions from '@/components/calendar/CalendarPersonalActions';
import DayDetail from '@/components/calendar/DayDetail';
import MonthGrid from '@/components/calendar/MonthGrid';
import MonthHeading from '@/components/calendar/MonthHeading';
import MonthSwitcher from '@/components/calendar/MonthSwitcher';
import TeamMonthNotice from '@/components/calendar/TeamMonthNotice';
import { useCalendarMonthState } from '@/components/calendar/UseCalendarMonthState';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';

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
  const team = month.source === CalendarMonthSource.TEAM ? month.team : null;
  const changedDates = team?.changes.map((change) => change.date) ?? [];
  const monthLabels = Object.fromEntries(
    summary.months.filter((item) => item.team).map((item) => [item.yearMonth, item.team?.teamName ?? '팀']),
  );
  const showShareBanner = summary.share.enabled && !month.shareVisible;

  return (
    <>
      <div className="label">{team ? `${team.teamName} 근무표` : '내 달력'}</div>
      <MonthHeading
        displayName={month.displayName}
        yearMonth={month.yearMonth}
        entries={month.entries}
        definitions={month.definitions}
      />
      <MonthSwitcher
        months={summary.months.map((item) => item.yearMonth)}
        current={yearMonth}
        labels={monthLabels}
        onChange={state.handleChangeMonth}
      />
      {team && (
        <TeamMonthNotice
          team={team}
          hasPersonalBackup={month.hasPersonalBackup}
          isAcking={state.isAcking}
          onAck={state.handleAckChanges}
        />
      )}
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
          changedDates={changedDates}
        />
      </div>
      {selectedEntry && (
        <DayDetail
          date={selectedEntry.date}
          code={selectedEntry.code}
          definitions={month.definitions}
          change={team?.changes.find((change) => change.date === selectedEntry.date)}
        />
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
      {team ? (
        <div className="center">
          <Link href="/teams" className="textbutton">
            내 팀 보기
          </Link>
        </div>
      ) : (
        <CalendarPersonalActions
          yearMonth={yearMonth}
          freeRemaining={summary.freeRemaining}
          priceKrw={summary.priceKrw}
          state={state}
        />
      )}
    </>
  );
};

export default CalendarMonthView;
