import { Fragment } from 'react';

import { formatRawText } from '@/client/DisplayText';
import { formatDayOnly } from '@/client/MonthLayout';
import { type SourceCell } from '@/domain/types/SourceCell';

type SourceStripProps = {
  sourceCells: SourceCell[];
  reviewDates: string[];
  selectedDate: string | null;
};

/**
 * Date headers above the selected row's raw text, as read from the photo. Scrolls horizontally inside
 * its own box so the page never overflows.
 */
const SourceStrip = ({ sourceCells, reviewDates, selectedDate }: SourceStripProps) => {
  const review = new Set(reviewDates);

  if (sourceCells.length === 0) {
    return null;
  }

  return (
    <div
      className="crop-scroll"
      tabIndex={0}
      role="region"
      aria-label="원본 근무표에서 읽은 내 행 (좌우로 스크롤)"
    >
      <div className="crop">
        {sourceCells.map((cell) => (
          <Fragment key={cell.date}>
            <span data-selected={cell.date === selectedDate}>{formatDayOnly(cell.date)}</span>
            <span className="raw" data-review={review.has(cell.date)}>
              {formatRawText(cell.rawText)}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
};

export default SourceStrip;
