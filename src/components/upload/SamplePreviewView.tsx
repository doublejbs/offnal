import {
  SAMPLE_DEFINITIONS,
  SAMPLE_ENTRIES,
  SAMPLE_PREVIEW_CAPTION,
  SAMPLE_PREVIEW_LABEL,
  SAMPLE_YEAR_MONTH,
} from '@/client/SamplePreviewData';
import MonthGrid from '@/components/calendar/MonthGrid';

/**
 * Entry-screen result preview (Spec §26.2): the shared month grid in static mode with fictional data, cut
 * after about two weeks and faded so "사진 선택" stays in the first phone viewport. One image for screen
 * readers; the cells inside are hidden.
 */
const SamplePreviewView = () => (
  <figure className="sample-preview">
    <div className="sample-preview-frame" role="img" aria-label={SAMPLE_PREVIEW_LABEL}>
      <div aria-hidden="true" className="sample-preview-grid">
        <MonthGrid
          yearMonth={SAMPLE_YEAR_MONTH}
          entries={SAMPLE_ENTRIES}
          definitions={SAMPLE_DEFINITIONS}
          selectedDate={null}
          showLegend={false}
          showToday={false}
        />
      </div>
    </div>
    <figcaption className="sample-preview-caption">{SAMPLE_PREVIEW_CAPTION}</figcaption>
  </figure>
);

export default SamplePreviewView;
