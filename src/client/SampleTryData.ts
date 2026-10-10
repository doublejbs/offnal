import { REGULAR_CODE, SAMPLE_PREVIEW_CODES, SAMPLE_YEAR_MONTH } from '@/client/SamplePreviewData';
import { ShiftReviewReason } from '@/domain/enums/ShiftReviewReason';
import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';
import { listDates } from '@/domain/YearMonth';

/**
 * Fixed data of the sample roster trial (Spec §26.3): a fictional ward roster for November 2026 and what
 * "recognition" made of it. Not real people (and not the E2E mock names), no hospital name.
 * `public/sample/roster.png` is drawn from this data by `scripts/GenerateSampleRoster.ts` — regenerate it
 * after changing anything here.
 */

export type SampleRosterPerson = {
  rowId: string;
  name: string;
  /** The codes printed on the roster, one per day of the month. */
  codes: string[];
  /** Day (1-based) whose cell is smudged in the photo: recognized as unreadable, shown as "확인 필요". */
  reviewDay: number;
};

export const SAMPLE_TRY_YEAR_MONTH = SAMPLE_YEAR_MONTH;

export const SAMPLE_TRY_IMAGE_PATH = '/sample/roster.png';

/** The photo is a full month wide; at 200% about two weeks fit a phone screen (pan for the rest). */
export const SAMPLE_TRY_IMAGE_ZOOM = 2;

export const SAMPLE_TRY_IMAGE_ALT = '예시 병동 근무표 사진: 가상의 이름 6명과 2026년 11월 날짜별 근무 코드';

/** Weekday office shift (상근), weekends off — November 2026 starts on a Sunday. */
const REGULAR_WEEKDAYS: string[] = listDates(SAMPLE_YEAR_MONTH).map((_, index) =>
  index % 7 === 0 || index % 7 === 6 ? 'OFF' : REGULAR_CODE,
);

/** The first person is the trial's default choice; their month equals the entry-screen preview. */
export const SAMPLE_ROSTER: SampleRosterPerson[] = [
  { rowId: 's1', name: '한서윤', codes: SAMPLE_PREVIEW_CODES, reviewDay: 11 },
  {
    rowId: 's2',
    name: '정민재',
    codes: [
      ...['N', 'N', 'OFF', 'OFF', 'D', 'D', 'E'],
      ...['E', 'N', 'N', 'OFF', 'OFF', 'D', 'D'],
      ...['E', 'E', 'OFF', 'N', 'N', 'OFF', 'OFF'],
      ...['D', 'D', 'E', 'E', 'N', 'OFF', 'OFF'],
      ...['D', 'E'],
    ],
    reviewDay: 9,
  },
  {
    rowId: 's3',
    name: '오가람',
    codes: [
      ...['OFF', 'D', 'D', 'E', 'E', 'N', 'N'],
      ...['OFF', 'OFF', 'D', 'D', 'E', 'E', 'N'],
      ...['N', 'OFF', 'OFF', 'D', 'D', 'E', 'E'],
      ...['N', 'N', 'OFF', 'OFF', 'D', 'D', 'E'],
      ...['E', 'OFF'],
    ],
    reviewDay: 13,
  },
  {
    rowId: 's4',
    name: '윤솔비',
    codes: [
      ...['E', 'E', 'N', 'N', 'OFF', 'OFF', 'D'],
      ...['D', 'E', 'E', 'N', 'N', 'OFF', 'OFF'],
      ...['D', 'D', 'E', 'E', 'N', 'N', 'OFF'],
      ...['OFF', 'D', 'D', 'E', 'E', 'N', 'N'],
      ...['OFF', 'OFF'],
    ],
    reviewDay: 5,
  },
  {
    rowId: 's5',
    name: '최다온',
    codes: [
      ...['D', 'OFF', 'E', 'E', 'N', 'N', 'OFF'],
      ...['D', 'D', 'OFF', 'E', 'E', 'N', 'N'],
      ...['OFF', 'D', 'D', 'E', 'OFF', 'N', 'N'],
      ...['OFF', 'OFF', 'D', 'D', 'E', 'E', 'N'],
      ...['N', 'OFF'],
    ],
    reviewDay: 17,
  },
  { rowId: 's6', name: '강유진', codes: REGULAR_WEEKDAYS, reviewDay: 12 },
];

export const SAMPLE_DEFAULT_ROW_ID = 's1';

export const SAMPLE_TRY_CANDIDATES: RecognitionCandidate[] = SAMPLE_ROSTER.map(({ rowId, name }) => ({
  rowId,
  name,
}));

export const findSamplePerson = (rowId: string): SampleRosterPerson =>
  SAMPLE_ROSTER.find((person) => person.rowId === rowId) ?? (SAMPLE_ROSTER[0] as SampleRosterPerson);

/** What the smudged cell really says (readable when zooming into the photo). */
export const getSuggestedCode = (person: SampleRosterPerson): string =>
  person.codes[person.reviewDay - 1] ?? 'OFF';

/** "Recognized" month of one person: every day confirmed except the smudged cell (null, unreadable). */
export const buildRecognizedEntries = (person: SampleRosterPerson): ShiftEntry[] =>
  listDates(SAMPLE_TRY_YEAR_MONTH).map((date, index) => {
    if (index + 1 === person.reviewDay) {
      return { date, code: null, reviewReasons: [ShiftReviewReason.UNREADABLE], confirmed: false };
    }

    return { date, code: person.codes[index] ?? 'OFF', reviewReasons: [], confirmed: true };
  });
