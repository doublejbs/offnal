import { type ComponentProps, createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AppShell from '@/components/AppShell';
import CalendarPersonalActions from '@/components/calendar/CalendarPersonalActions';
import ConfigProvider from '@/components/ConfigProvider';
import PublishPanel from '@/components/draft/PublishPanel';
import BlurredPreviewGate from '@/components/recognition/BlurredPreviewGate';
import TeamIntroView from '@/components/team/TeamIntroView';
import UploadPanel from '@/components/upload/UploadPanel';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { BillingMode } from '@/domain/enums/BillingMode';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/**
 * Smoke renders (react-dom/server, no DOM library) of every screen that shows billing copy: in beta
 * free mode none of it may appear (Spec §20.4); paid mode keeps today's copy.
 */

/** Price, free months, payment, passes, purchase, test payment. "원본" is fine, "990원" is not. */
const BILLING_WORDS = /무료|결제|\d[\d,]*원|이용권|구매|비용|두 달/;

const buildConfig = (billingMode: BillingMode): PublicConfigResponse => ({
  appMode: AppMode.LIVE,
  billingMode,
  priceKrw: 990,
  freeMonthLimit: 2,
  authProviders: [AuthProviderType.KAKAO],
  paymentProvider: PaymentProviderType.MOCK,
  visionProvider: VisionProviderType.MOCK,
  isMockVision: true,
  isMockPayment: billingMode === BillingMode.PAID,
  uploadMaxBytes: 10 * 1024 * 1024,
  sourceTtlHours: 24,
});

const renderWithConfig = (
  billingMode: BillingMode,
  element: ReactElement,
  overrides: Partial<PublicConfigResponse> = {},
): string =>
  renderToStaticMarkup(
    createElement(
      ConfigProvider,
      { config: { ...buildConfig(billingMode), ...overrides } } as ComponentProps<typeof ConfigProvider>,
      element,
    ),
  );

const noop = () => undefined;

const calendarState = {
  handleEdit: noop,
  isEditing: false,
  setIsDeleteOpen: noop,
  isDeleteOpen: true,
  isDeleting: false,
  handleDelete: noop,
} as unknown as Parameters<typeof CalendarPersonalActions>[0]['state'];

const publish = {
  isPublishing: false,
  publishError: null,
  isStaleBase: false,
  handlePublish: noop,
  handleRestartFromPublished: noop,
} as unknown as Parameters<typeof PublishPanel>[0]['publish'];

const renderPublishPanel = (billingMode: BillingMode, monthAccess: MonthAccess): string =>
  renderWithConfig(
    billingMode,
    createElement(PublishPanel, {
      access: { monthAccess, freeRemaining: 0, priceKrw: 990 },
      blockers: [],
      needsTimeConfirmation: false,
      canPublish: true,
      publish,
      onSelectBlocker: noop,
      onSelectTimeConfirmation: noop,
    }),
  );

const renderCalendarActions = (isBeta: boolean): string =>
  renderToStaticMarkup(
    createElement(CalendarPersonalActions, {
      yearMonth: '2026-11',
      freeRemaining: 0,
      priceKrw: 990,
      isBeta,
      state: calendarState,
    }),
  );

const renderShell = (isBeta: boolean): string =>
  renderToStaticMarkup(
    createElement(
      AppShell,
      { bannerText: null, isLoggedIn: false, isBeta } as ComponentProps<typeof AppShell>,
      createElement('p', null, 'body'),
    ),
  );

describe('beta free copy (smoke render)', () => {
  it('app shell: a small 베타 label next to the wordmark only in beta', () => {
    const beta = renderShell(true);

    expect(beta).toMatch(/<span class="beta-chip">베타<span class="visually-hidden"> 서비스<\/span><\/span>/);
    expect(beta).not.toContain('demo-banner');
    expect(renderShell(false)).not.toContain('beta-chip');
  });

  it('upload panel (signed out, with the landing guide)', () => {
    const beta = renderWithConfig(BillingMode.BETA_FREE, createElement(UploadPanel, { isLoggedIn: false }));
    const paid = renderWithConfig(BillingMode.PAID, createElement(UploadPanel, { isLoggedIn: false }));

    expect(beta).not.toMatch(BILLING_WORDS);
    expect(beta).toContain('근무표 사진을 올려 주세요');
    expect(paid).toContain('처음 두 달은 무료');
    expect(paid).toContain('그다음 달부터 한 달분 990원.');
    expect(paid).toContain('무료로 몇 달 쓸 수 있나요?');
  });

  it('upload panel (signed in)', () => {
    const beta = renderWithConfig(BillingMode.BETA_FREE, createElement(UploadPanel, { isLoggedIn: true }));
    const paid = renderWithConfig(BillingMode.PAID, createElement(UploadPanel, { isLoggedIn: true }));

    expect(beta).not.toMatch(BILLING_WORDS);
    expect(beta).toContain('팀으로 함께 쓰기');
    expect(paid).toContain('팀으로 함께 쓰기 (베타 기간 무료)');
  });

  it('blurred preview gate', () => {
    const element = createElement(BlurredPreviewGate, { recognitionId: 'r1', loginFailed: false });
    const beta = renderWithConfig(BillingMode.BETA_FREE, element);
    const paid = renderWithConfig(BillingMode.PAID, element);
    // The button label shows only on the demo login form (Kakao keeps its brand label).
    const demoOnly = { authProviders: [AuthProviderType.DEV] };
    const betaDemo = renderWithConfig(BillingMode.BETA_FREE, element, demoOnly);

    expect(beta).not.toMatch(BILLING_WORDS);
    expect(betaDemo).not.toMatch(BILLING_WORDS);
    expect(betaDemo).toContain('로그인하고 확인');
    expect(paid).toContain('처음 두 달 무료 · 카드 등록 없이 시작');
    expect(renderWithConfig(BillingMode.PAID, element, demoOnly)).toContain('로그인하고 무료로 확인');
  });

  it('publish panel', () => {
    const beta = renderPublishPanel(BillingMode.BETA_FREE, MonthAccess.BETA_FREE);
    const betaExisting = renderPublishPanel(BillingMode.BETA_FREE, MonthAccess.EXISTING);

    expect(beta).not.toMatch(BILLING_WORDS);
    expect(beta).toContain('>확인하고 저장</button>');
    expect(beta).toContain('저장하면 바로 달력에 반영돼요');
    expect(betaExisting).not.toMatch(BILLING_WORDS);
    expect(betaExisting).toContain('>확인하고 저장</button>');
    expect(betaExisting).toContain('이미 등록한 달이에요. 고친 내용으로 다시 저장돼요');
    expect(renderPublishPanel(BillingMode.PAID, MonthAccess.TRIAL_AVAILABLE)).toContain(
      '확인하고 무료로 저장',
    );
    expect(renderPublishPanel(BillingMode.PAID, MonthAccess.PAYMENT_REQUIRED)).toContain(
      '990원 구매 후 저장',
    );
  });

  it('calendar personal actions: no price hint, beta delete confirmation', () => {
    const beta = renderCalendarActions(true);
    const paid = renderCalendarActions(false);

    expect(beta).not.toMatch(BILLING_WORDS);
    expect(beta).toContain('달력과 공유 링크에서 이 달이 사라져요. 같은 달은 언제든 다시 등록할 수 있어요.');
    expect(paid).toContain('새 달은 한 달분 990원 · 자동 결제 없음');
    expect(paid).toContain('이미 사용한 무료 월이나 구매한 이용권은 그대로 남아서');
  });

  it('team intro', () => {
    const beta = renderToStaticMarkup(createElement(TeamIntroView, { isBeta: true }));
    const paid = renderToStaticMarkup(createElement(TeamIntroView, { isBeta: false }));

    expect(beta).not.toMatch(BILLING_WORDS);
    expect(beta).toContain('팀 공유는 이렇게 써요');
    expect(paid).toContain('지금은 베타 기간이라 무료예요. 결제 정보를 받지 않아요.');
  });
});
