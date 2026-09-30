import { describe, expect, it } from 'vitest';

import {
  buildLandingFaqs,
  formatHours,
  LANDING_RECIPIENT_POINTS,
  LANDING_SHARE_METHODS,
  LANDING_STEPS,
} from '@/client/LandingCopy';
import { ExportPanel } from '@/domain/enums/ExportPanel';

const SOURCE = { freeMonthLimit: 2, priceKrw: 1900, sourceTtlHours: 24 };

const findAnswer = (source: typeof SOURCE, question: string): string => {
  const faq = buildLandingFaqs(source).find((item) => item.question.includes(question));

  if (!faq) {
    throw new Error(`FAQ not found: ${question}`);
  }

  return faq.answer;
};

describe('landing copy', () => {
  it('formats hours', () => {
    expect(formatHours(24)).toBe('24시간');
  });

  it('interpolates free months and a formatted price', () => {
    expect(findAnswer(SOURCE, '무료로 몇 달')).toBe(
      '처음 저장하는 두 달은 무료예요. 그다음부터는 새로 저장하는 달마다 한 달분 1,900원이고, 자동 결제는 없어요.',
    );
    expect(findAnswer({ ...SOURCE, freeMonthLimit: 3, priceKrw: 12500 }, '무료로 몇 달')).toContain(
      '처음 저장하는 세 달은 무료예요. 그다음부터는 새로 저장하는 달마다 한 달분 12,500원',
    );
  });

  it('drops the free-month sentence when there are no free months', () => {
    const answer = findAnswer({ ...SOURCE, freeMonthLimit: 0 }, '무료로 몇 달');

    expect(answer).toBe('새로 저장하는 달마다 한 달분 1,900원이에요. 자동 결제는 없어요.');
  });

  it('interpolates the source photo retention hours', () => {
    expect(findAnswer(SOURCE, '원본 사진')).toContain('올린 뒤 24시간이 지나면 자동으로 삭제');
    expect(findAnswer({ ...SOURCE, sourceTtlHours: 6 }, '원본 사진')).toContain('올린 뒤 6시간이 지나면');
  });

  it('keeps four questions and promises no automatic calendar sync or name in previews', () => {
    const faqs = buildLandingFaqs(SOURCE);

    expect(faqs).toHaveLength(4);
    expect(findAnswer(SOURCE, '근무가 바뀌면')).toContain('자동으로 바뀌지 않아요');
    expect(findAnswer(SOURCE, '미리보기')).toMatch(/^아니요\./);
  });

  it('lists three steps, three share methods (link, ICS, image) and recipient points', () => {
    expect(LANDING_STEPS).toHaveLength(3);
    expect(LANDING_SHARE_METHODS.map((item) => item.method)).toEqual([
      ExportPanel.LINK,
      ExportPanel.ICS,
      ExportPanel.PNG,
    ]);
    expect(LANDING_SHARE_METHODS[1]?.description).toContain('자동으로 반영되지는 않아요');
    expect(LANDING_RECIPIENT_POINTS).toHaveLength(4);
  });

  it('makes no accuracy claims', () => {
    const allText = [
      ...LANDING_STEPS.flatMap((step) => [step.title, step.description]),
      ...LANDING_SHARE_METHODS.flatMap((item) => [item.title, item.description]),
      ...LANDING_RECIPIENT_POINTS,
      ...buildLandingFaqs(SOURCE).flatMap((faq) => [faq.question, faq.answer]),
    ].join(' ');

    expect(allText).not.toMatch(/완벽|정확도|%|자동 동기화/);
  });
});
