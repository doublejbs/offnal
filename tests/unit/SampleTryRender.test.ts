import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_TRY_CTA_TEXT,
  SAMPLE_TRY_DESCRIPTION,
  SAMPLE_TRY_NOTICE,
  SAMPLE_TRY_TITLE,
  SAMPLE_TRY_UPLOAD_HREF,
} from '@/client/SampleTryCopy';
import {
  SAMPLE_DEFAULT_ROW_ID,
  SAMPLE_ROSTER,
  SAMPLE_TRY_IMAGE_ALT,
  SAMPLE_TRY_IMAGE_PATH,
} from '@/client/SampleTryData';
import {
  createInitialSampleTryState,
  goNext,
  type SampleTryState,
  selectCode,
  selectDate,
} from '@/client/SampleTryFlow';
import SampleChooseStepView from '@/components/try/SampleChooseStepView';
import SampleDoneStepView from '@/components/try/SampleDoneStepView';
import SampleReadStepView from '@/components/try/SampleReadStepView';
import SampleReviewStepView from '@/components/try/SampleReviewStepView';
import SampleTryScreen from '@/components/try/SampleTryScreen';
import { BillingMode } from '@/domain/enums/BillingMode';
import { buildSampleTryMetadata } from '@/server/metadata/SiteMetadata';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/** Sample roster trial screens (Spec §26.3): notice, real-flow grammar, accessible names, beta copy rules. */

const BILLING_WORDS = /무료|결제|\d[\d,]*원|이용권|구매|비용|가격/;
const REVIEW_DATE = '2026-11-11';
const noop = () => undefined;

const textOf = (html: string): string => html.replace(/<br\/?>/g, '\n').replace(/<[^>]+>/g, '');

const reviewState = (): SampleTryState => goNext(goNext(createInitialSampleTryState()));

const doneState = (): SampleTryState => goNext(selectCode(selectDate(reviewState(), REVIEW_DATE), 'E'));

const renderRead = (): string =>
  renderToStaticMarkup(
    createElement(SampleReadStepView, { headingRef: createRef<HTMLHeadingElement>(), onNext: noop }),
  );

const renderChoose = (): string =>
  renderToStaticMarkup(
    createElement(SampleChooseStepView, {
      headingRef: createRef<HTMLHeadingElement>(),
      selectedRowId: SAMPLE_DEFAULT_ROW_ID,
      onSelect: noop,
      onNext: noop,
      onBack: noop,
    }),
  );

const renderReview = (state: SampleTryState): string =>
  renderToStaticMarkup(
    createElement(SampleReviewStepView, {
      headingRef: createRef<HTMLHeadingElement>(),
      state,
      onSelectDate: noop,
      onSelectCode: noop,
      onNext: noop,
      onBack: noop,
    }),
  );

const renderDone = (): string =>
  renderToStaticMarkup(
    createElement(SampleDoneStepView, {
      headingRef: createRef<HTMLHeadingElement>(),
      state: doneState(),
      ctaHref: SAMPLE_TRY_UPLOAD_HREF,
      onCtaClick: noop,
      onBack: noop,
    }),
  );

describe('sample trial screen', () => {
  it('starts at step 1 under the "nothing is saved" notice', () => {
    const html = renderToStaticMarkup(createElement(SampleTryScreen));

    expect(SAMPLE_TRY_NOTICE).toBe('예시 체험 · 실제 저장되지 않아요');
    expect(html).toMatch(new RegExp(`role="note"[^>]*>(<svg[\\s\\S]*?</svg>)?${SAMPLE_TRY_NOTICE}</div>`));
    expect(html.indexOf(SAMPLE_TRY_NOTICE)).toBeLessThan(html.indexOf('근무표를 읽었어요.'));
    expect(textOf(html)).toContain('1 / 4');
  });

  it('shows no price, free or payment wording on any step', () => {
    for (const html of [renderRead(), renderChoose(), renderReview(reviewState()), renderDone()]) {
      expect(textOf(html)).not.toMatch(BILLING_WORDS);
    }

    expect(SAMPLE_TRY_DESCRIPTION).not.toMatch(BILLING_WORDS);
  });
});

describe('step views', () => {
  it('step 1 shows the fictional roster photo and leaves through a non-prefetching link', () => {
    const html = renderRead();

    expect(html).toContain(`src="${SAMPLE_TRY_IMAGE_PATH}"`);
    expect(html).toContain(`alt="${SAMPLE_TRY_IMAGE_ALT}"`);
    expect(html).toContain('href="/"');
    expect(html).toMatch(/<button type="button" class="primary">내 이름 고르기<\/button>/);
  });

  it('step 2 lists every fictional name as a radio, the default checked', () => {
    const html = renderChoose();

    for (const person of SAMPLE_ROSTER) {
      expect(html).toMatch(
        new RegExp(
          `<label class="person"><span>${person.name}</span><input type="radio" name="person"[^>]*value="${person.rowId}"`,
        ),
      );
    }

    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain(`checked="" value="${SAMPLE_DEFAULT_ROW_ID}"`);
    expect(html).toContain('근무표 다시 보기');
  });

  it('step 3 marks the unreadable day for review and blocks finishing until it is fixed', () => {
    const html = renderReview(reviewState());

    expect(html).toContain('확인 필요한 날짜가 1일 있어요: 11일');
    expect(html).toContain('aria-label="11월 11일 근무 미확인 확인 필요"');
    expect(html).toMatch(/<button type="button" class="primary" disabled="">확인 완료<\/button>/);
    expect(html).not.toContain('today-mark');
  });

  it('step 3 editor offers the sample codes with accessible names and the faint original', () => {
    const html = renderReview(selectDate(reviewState(), REVIEW_DATE));

    expect(html).toContain('role="group" aria-label="근무 코드 선택"');

    for (const name of ['D 데이', 'E 이브닝', 'N 나이트', 'OFF 휴무', '상근 상근']) {
      expect(html).toContain(`aria-label="${name}"`);
    }

    expect(textOf(html)).toContain('원본: 읽지 못함');
    expect(textOf(html)).toContain('사진 속 흐린 글자: E');
    expect(html).not.toContain('코드 추가');
  });

  it('step 3 unlocks finishing once the cell is fixed', () => {
    const html = renderReview(selectCode(selectDate(reviewState(), REVIEW_DATE), 'E'));

    expect(html).toContain('모든 날짜를 확인했어요');
    expect(html).toMatch(/<button type="button" class="primary">확인 완료<\/button>/);
    expect(html).toContain('aria-label="11월 11일 E"');
  });

  it('step 4 explains sharing in text only and has one primary action to the upload box', () => {
    const html = renderDone();
    const text = textOf(html);

    expect(text).toContain('공유 링크·캘린더 추가·이미지 저장을 할 수 있어요');
    expect(html.match(/class="primary[ "]/g)).toHaveLength(1);
    expect(html).toMatch(
      new RegExp(`<a class="primary" href="${SAMPLE_TRY_UPLOAD_HREF}">${SAMPLE_TRY_CTA_TEXT}</a>`),
    );
    // Static month (no day buttons) and no look-alike share/calendar/image buttons.
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('결과 다시 확인');
  });
});

describe('/try CTA', () => {
  it('always goes to the upload page, which works signed in or out', () => {
    expect(SAMPLE_TRY_UPLOAD_HREF).toBe('/upload#upload');
  });
});

describe('/try metadata', () => {
  it('has its own title and description and stays indexable', () => {
    const metadata = buildSampleTryMetadata({
      appUrl: 'https://offnal.example',
      billingMode: BillingMode.BETA_FREE,
      priceKrw: 990,
      freeMonthLimit: 2,
    });

    expect(SAMPLE_TRY_TITLE).toBe('예시 근무표 체험');
    expect(metadata.title).toBe(SAMPLE_TRY_TITLE);
    expect(metadata.description).toBe(SAMPLE_TRY_DESCRIPTION);
    expect(metadata.robots).toBeUndefined();
    expect(metadata.openGraph).toMatchObject({ url: '/try', description: SAMPLE_TRY_DESCRIPTION });
  });
});
