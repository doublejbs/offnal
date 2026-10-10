'use client';

import { Image as ImageIcon } from 'lucide-react';
import { type RefObject, useState } from 'react';

import { formatReviewWarning } from '@/client/DisplayText';
import { SAMPLE_DEFINITIONS } from '@/client/SamplePreviewData';
import {
  findSamplePerson,
  SAMPLE_TRY_IMAGE_ALT,
  SAMPLE_TRY_IMAGE_ZOOM,
  SAMPLE_TRY_IMAGE_PATH,
  SAMPLE_TRY_YEAR_MONTH,
} from '@/client/SampleTryData';
import { listReviewDates, type SampleTryState } from '@/client/SampleTryFlow';
import MonthGrid from '@/components/calendar/MonthGrid';
import SourcePreview from '@/components/SourcePreview';
import SampleBackButtonView from '@/components/try/SampleBackButtonView';
import SampleShiftEditorView from '@/components/try/SampleShiftEditorView';
import { dayOfDate, formatYearMonthLabel } from '@/domain/YearMonth';

type SampleReviewStepViewProps = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  state: SampleTryState;
  onSelectDate: (date: string) => void;
  onSelectCode: (code: string) => void;
  onNext: () => void;
  onBack: () => void;
};

/**
 * Step 3: the chosen person's month in the real review layout (`DraftEditorView`): warning, original photo,
 * the shared month grid and the editing area. One cell is deliberately unreadable; fixing it unlocks step 4.
 */
const SampleReviewStepView = ({
  headingRef,
  state,
  onSelectDate,
  onSelectCode,
  onNext,
  onBack,
}: SampleReviewStepViewProps) => {
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const person = findSamplePerson(state.entriesRowId);
  const reviewDates = listReviewDates(state.entries);
  const warning = formatReviewWarning({ count: reviewDates.length, dates: reviewDates });
  const selectedEntry = state.entries.find((entry) => entry.date === state.selectedDate) ?? null;
  const selectedDay = selectedEntry ? dayOfDate(selectedEntry.date) : null;

  return (
    <>
      <SampleBackButtonView label="이름 다시 고르기" onBack={onBack} />
      <div className="label">3 / 4 · 인식 결과 확인</div>
      <h1 ref={headingRef} tabIndex={-1}>
        내 근무가 맞는지
        <br />
        확인해 주세요.
      </h1>
      <div className="tiny">
        {person.name} · {formatYearMonthLabel(SAMPLE_TRY_YEAR_MONTH)} · 날짜를 눌러 수정
      </div>
      {warning ? (
        <div className="warning keep-all">
          {warning}
          <div>주황색 칸을 눌러 원본 사진과 비교해 고쳐 보세요.</div>
        </div>
      ) : (
        <div className="notice">모든 날짜를 확인했어요. 이제 달력을 완성해 보세요.</div>
      )}
      <button
        type="button"
        className="textbutton"
        aria-expanded={isSourceOpen}
        onClick={() => setIsSourceOpen((value) => !value)}
      >
        <ImageIcon size={16} aria-hidden="true" />
        {isSourceOpen ? '원본 사진 닫기' : '원본 사진 크게 보기'}
      </button>
      {isSourceOpen && (
        <SourcePreview
          src={SAMPLE_TRY_IMAGE_PATH}
          alt={SAMPLE_TRY_IMAGE_ALT}
          initialZoom={SAMPLE_TRY_IMAGE_ZOOM}
        />
      )}
      <div className="mt-14">
        <MonthGrid
          yearMonth={SAMPLE_TRY_YEAR_MONTH}
          entries={state.entries}
          definitions={SAMPLE_DEFINITIONS}
          selectedDate={state.selectedDate}
          onSelectDate={onSelectDate}
          showToday={false}
        />
      </div>
      {selectedEntry && selectedDay !== null && (
        <SampleShiftEditorView
          entry={selectedEntry}
          printedCode={person.codes[selectedDay - 1] ?? ''}
          isSmudged={selectedDay === person.reviewDay}
          onSelectCode={onSelectCode}
        />
      )}
      <div className="pt-20">
        <button type="button" className="primary" onClick={onNext} disabled={reviewDates.length > 0}>
          확인 완료
        </button>
        {reviewDates.length > 0 && (
          <div className="status-line mt-10 center">확인 필요한 날짜를 고치면 완성할 수 있어요.</div>
        )}
      </div>
    </>
  );
};

export default SampleReviewStepView;
