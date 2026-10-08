import { describe, expect, it } from 'vitest';

import {
  buildLandingFaqs,
  formatHours,
  getLandingTeamText,
  LANDING_RECIPIENT_POINTS,
  LANDING_SHARE_METHODS,
  LANDING_STEPS,
  LANDING_TEAM_TEXT,
} from '@/client/LandingCopy';
import { BillingMode } from '@/domain/enums/BillingMode';
import { ExportPanel } from '@/domain/enums/ExportPanel';

const SOURCE = { billingMode: BillingMode.PAID, freeMonthLimit: 2, priceKrw: 990, sourceTtlHours: 24 };

const BETA_SOURCE = { ...SOURCE, billingMode: BillingMode.BETA_FREE };

/** Beta copy must not mention price, free months, payment or passes (Spec §20.4). "원본" is fine, "990원" is not. */
const BILLING_WORDS = /무료|결제|\d[\d,]*원|이용권|구매|비용/;

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
      '근무를 저장한 달을 기준으로 두 달까지 무료예요. 이미 저장한 달을 고쳐 다시 저장해도 무료 달이 줄거나 비용이 생기지 않고, 무료 달을 다 쓴 뒤 새 달을 저장할 때만 한 달분 990원을 결제해요.',
    );

    const custom = findAnswer({ ...SOURCE, freeMonthLimit: 3, priceKrw: 12500 }, '무료로 몇 달');

    expect(custom).toContain('저장한 달을 기준으로 세 달까지 무료예요');
    expect(custom).toContain('한 달분 12,500원을 결제해요');
  });

  it('drops the free-month sentence when there are no free months', () => {
    const answer = findAnswer({ ...SOURCE, freeMonthLimit: 0 }, '무료로 몇 달');

    expect(answer).toBe(
      '새로 저장하는 달마다 한 달분 990원이에요. 이미 저장한 달을 고쳐 다시 저장할 때는 추가 비용이 없어요.',
    );
  });

  it('interpolates the source photo retention hours', () => {
    // Access is blocked at expiry; the daily cleanup deletes later, so the copy must not promise deletion at 24h.
    expect(findAnswer(SOURCE, '원본 사진')).toContain(
      '올린 뒤 24시간이 지나면 더 이상 열 수 없고, 이후 자동으로 삭제돼요.',
    );
    expect(findAnswer({ ...SOURCE, sourceTtlHours: 6 }, '원본 사진')).toContain('올린 뒤 6시간이 지나면');
  });

  it('keeps four questions and promises no automatic calendar sync or name in previews', () => {
    const faqs = buildLandingFaqs(SOURCE);

    expect(faqs).toHaveLength(4);
    expect(findAnswer(SOURCE, '근무가 바뀌면')).toContain('자동으로 바뀌지 않아요');
    expect(findAnswer(SOURCE, '근무가 바뀌면')).toContain('공유 중인 달이면 같은 링크에 바로 반영돼요');
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
    expect(LANDING_RECIPIENT_POINTS[3]).toContain('공유 중인 달이면');
  });

  it('makes no accuracy claims', () => {
    const allText = [
      ...LANDING_STEPS.flatMap((step) => [step.title, step.description]),
      ...LANDING_SHARE_METHODS.flatMap((item) => [item.title, item.description]),
      ...LANDING_RECIPIENT_POINTS,
      LANDING_TEAM_TEXT,
      ...buildLandingFaqs(SOURCE).flatMap((faq) => [faq.question, faq.answer]),
    ].join(' ');

    expect(allText).not.toMatch(/완벽|정확도|%|자동 동기화/);
  });

  it('describes team sharing honestly as a free beta (no price promised)', () => {
    expect(LANDING_TEAM_TEXT).toContain('베타 기간 무료');
    expect(LANDING_TEAM_TEXT).not.toMatch(/\d[\d,]*원|영구|평생/);
  });

  it('paid mode team text is the same constant', () => {
    expect(getLandingTeamText(BillingMode.PAID)).toBe(LANDING_TEAM_TEXT);
  });

  it('beta free: no price, free months or payment in the FAQ or team text', () => {
    const faqs = buildLandingFaqs(BETA_SOURCE);
    const allText = [
      ...faqs.flatMap((faq) => [faq.question, faq.answer]),
      getLandingTeamText(BillingMode.BETA_FREE),
    ].join(' ');

    expect(faqs.some((faq) => faq.question.includes('무료로 몇 달'))).toBe(false);
    expect(faqs).toHaveLength(3);
    expect(allText).not.toMatch(BILLING_WORDS);
    expect(findAnswer(BETA_SOURCE, '근무가 바뀌면')).toBe(
      '새 근무표 사진을 올리거나 달력에서 직접 고친 뒤 다시 저장하면 돼요. 공유 중인 달이면 같은 링크에 바로 반영돼요. 캘린더에 이미 추가한 일정은 자동으로 바뀌지 않아요.',
    );
    expect(findAnswer(BETA_SOURCE, '원본 사진')).toContain('올린 뒤 24시간이 지나면');
    expect(getLandingTeamText(BillingMode.BETA_FREE)).toBe(
      '근무표 담당자가 사진을 한 번 올리면 팀원 모두가 각자 달력을 받아요.',
    );
  });
});
