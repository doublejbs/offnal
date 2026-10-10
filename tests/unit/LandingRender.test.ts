import { type ComponentProps, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_DEFINITIONS,
  SAMPLE_ENTRIES,
  SAMPLE_PREVIEW_CAPTION,
  SAMPLE_PREVIEW_LABEL,
  SAMPLE_YEAR_MONTH,
} from '@/client/SamplePreviewData';
import ConfigProvider from '@/components/ConfigProvider';
import SamplePreviewView from '@/components/upload/SamplePreviewView';
import UploadPanel from '@/components/upload/UploadPanel';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { BillingMode } from '@/domain/enums/BillingMode';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { TeamMode } from '@/domain/enums/TeamMode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import { listDates } from '@/domain/YearMonth';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/** Entry screen (Spec §26.1·§26.2·§26.4): copy, the sample calendar preview and the share-later control. */

const SHARE_URL = 'http://localhost:3100/?utm_source=share_later';
const BILLING_WORDS = /무료|결제|\d[\d,]*원|이용권|구매|비용|두 달/;

const CONFIG: PublicConfigResponse = {
  appMode: AppMode.LIVE,
  billingMode: BillingMode.BETA_FREE,
  teamMode: TeamMode.COMING_SOON,
  priceKrw: 990,
  freeMonthLimit: 2,
  authProviders: [AuthProviderType.KAKAO],
  paymentProvider: PaymentProviderType.TOSS,
  visionProvider: VisionProviderType.MOCK,
  isMockVision: false,
  isMockPayment: false,
  uploadMaxBytes: 10 * 1024 * 1024,
  sourceTtlHours: 24,
};

const renderLanding = (isLoggedIn = false): string =>
  renderToStaticMarkup(
    createElement(
      ConfigProvider,
      { config: CONFIG } as ComponentProps<typeof ConfigProvider>,
      createElement(UploadPanel, { isLoggedIn, shareLaterUrl: SHARE_URL }),
    ),
  );

const textOf = (html: string): string => html.replace(/<br\/?>/g, '\n').replace(/<[^>]+>/g, '');

describe('entry screen copy (§26.1)', () => {
  it('keeps the title and shows the nurse-facing subtitle', () => {
    const text = textOf(renderLanding());

    expect(text).toContain('근무표 한 장이면\n이번 달 준비 끝.');
    expect(text).toContain('3교대 근무표 사진 한 장으로\n내 D·E·N만 달력에 정리하고 공유해요.');
    expect(text).not.toContain('가족과 친구에게 공유해 보세요');
  });

  it('shows no price or free wording in beta', () => {
    expect(renderLanding()).not.toMatch(BILLING_WORDS);
  });

  it('has a single primary action and no link to the sample trial yet', () => {
    const html = renderLanding();

    expect(html.match(/class="primary[ "]/g)).toHaveLength(1);
    expect(html).not.toContain('href="/try"');
  });
});

describe('result preview (§26.2)', () => {
  it('sits between the subtitle and the upload box', () => {
    const html = renderLanding();
    const subtitle = html.indexOf('3교대 근무표 사진 한 장으로');
    const preview = html.indexOf(`aria-label="${SAMPLE_PREVIEW_LABEL}"`);
    const upload = html.indexOf('근무표 사진을 올려 주세요');

    expect(subtitle).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(subtitle);
    expect(upload).toBeGreaterThan(preview);
  });

  it('is one image with the exact accessible name; cells are hidden from assistive tech', () => {
    const html = renderToStaticMarkup(createElement(SamplePreviewView));

    expect(SAMPLE_PREVIEW_LABEL).toBe(
      '예시 근무 달력: D 데이·E 이브닝·N 나이트·OFF 휴무가 날짜마다 표시된 달력',
    );
    expect(html).toContain(`role="img" aria-label="${SAMPLE_PREVIEW_LABEL}"`);

    // MonthGrid's static cells carry their own role="img" labels: all of them sit inside the aria-hidden part.
    const hiddenStart = html.indexOf('<div aria-hidden="true" class="sample-preview-grid">');
    const firstCell = html.indexOf('class="day" role="img"');

    expect(hiddenStart).toBeGreaterThan(html.indexOf(`aria-label="${SAMPLE_PREVIEW_LABEL}"`));
    expect(firstCell).toBeGreaterThan(hiddenStart);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('today-mark');
    expect(html).not.toContain('오늘, ');
    expect(textOf(html)).toContain(SAMPLE_PREVIEW_CAPTION);
    expect(SAMPLE_PREVIEW_CAPTION).toBe('이런 달력이 만들어져요 · 예시');
  });

  it('uses a full fictional month mixing D, E, N, OFF and 상근', () => {
    expect(SAMPLE_ENTRIES.map((entry) => entry.date)).toEqual(listDates(SAMPLE_YEAR_MONTH));

    const codes = new Set(SAMPLE_ENTRIES.map((entry) => entry.code));

    expect([...codes].sort()).toEqual(['D', 'E', 'N', 'OFF', '상근'].sort());
    expect(SAMPLE_ENTRIES.every((entry) => entry.confirmed && entry.reviewReasons.length === 0)).toBe(true);
    expect(SAMPLE_DEFINITIONS.map((definition) => definition.code).sort()).toEqual([...codes].sort());

    // The first two weeks (the visible part) already show every code.
    const firstTwoWeeks = new Set(SAMPLE_ENTRIES.slice(0, 14).map((entry) => entry.code));

    expect(firstTwoWeeks.size).toBe(codes.size);
  });
});

describe('share later (§26.4)', () => {
  it('is a secondary control below the upload box', () => {
    const html = renderLanding();
    const upload = html.indexOf('근무표 사진을 올려 주세요');
    const shareLater = html.indexOf('지금 사진이 없나요? 링크 보내 두기');

    expect(shareLater).toBeGreaterThan(upload);
    expect(html).toMatch(
      /<button type="button" class="secondary[^"]*"[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?지금 사진이 없나요\? 링크 보내 두기<\/button>/,
    );
  });
});
