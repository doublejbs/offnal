'use client';

import Link from 'next/link';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import { type useCalendarMonthState } from '@/components/calendar/UseCalendarMonthState';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatYearMonthLabel } from '@/domain/YearMonth';

const PAID_DELETE_MESSAGE =
  '달력과 공유 링크에서 이 달이 사라져요. 이미 사용한 무료 월이나 구매한 이용권은 그대로 남아서, 같은 달을 다시 등록해도 추가 비용이 없어요.';
const BETA_DELETE_MESSAGE = '달력과 공유 링크에서 이 달이 사라져요. 같은 달은 언제든 다시 등록할 수 있어요.';

type CalendarPersonalActionsProps = {
  yearMonth: string;
  freeRemaining: number;
  priceKrw: number;
  /** Beta free mode: no price hint, delete confirmation without passes or cost (Spec §20.4). */
  isBeta: boolean;
  state: ReturnType<typeof useCalendarMonthState>;
};

/** Edit / next month / delete — personal months only (team months are read-only for the member). */
const CalendarPersonalActions = ({
  yearMonth,
  freeRemaining,
  priceKrw,
  isBeta,
  state,
}: CalendarPersonalActionsProps) => (
  <>
    <div className="actionrow">
      <button type="button" className="secondary" onClick={state.handleEdit} disabled={state.isEditing}>
        {state.isEditing ? '여는 중…' : '근무 수정'}
      </button>
      <Link href="/upload" className="secondary">
        다음 달 등록
      </Link>
    </div>
    {!isBeta && (
      <div className="hint">
        {freeRemaining > 0
          ? `무료로 ${formatMonthCount(freeRemaining)} 더 이용할 수 있어요.`
          : `새 달은 한 달분 ${formatPrice(priceKrw)} · 자동 결제 없음`}
      </div>
    )}
    <div className="center">
      <button type="button" className="textbutton" onClick={() => state.setIsDeleteOpen(true)}>
        이 달 달력 삭제
      </button>
    </div>
    <ConfirmDialog
      isOpen={state.isDeleteOpen}
      title={`${formatYearMonthLabel(yearMonth)} 달력을 삭제할까요?`}
      message={isBeta ? BETA_DELETE_MESSAGE : PAID_DELETE_MESSAGE}
      confirmLabel="삭제"
      isDanger
      isBusy={state.isDeleting}
      onConfirm={state.handleDelete}
      onCancel={() => state.setIsDeleteOpen(false)}
    />
  </>
);

export default CalendarPersonalActions;
