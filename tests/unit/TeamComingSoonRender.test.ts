import { type ComponentProps, createElement, type ReactElement } from 'react';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import JoinLayout from '@/app/join/layout';
import JoinPage from '@/app/join/[token]/page';
import TeamsLayout from '@/app/teams/layout';
import TeamsPage from '@/app/teams/page';
import TeamPage from '@/app/teams/[id]/page';
import TeamRosterPage from '@/app/teams/[id]/roster/[yearMonth]/page';
import RosterPage from '@/app/teams/[id]/rosters/[rosterId]/page';
import CalendarMonthView from '@/components/calendar/CalendarMonthView';
import TeamMonthNotice from '@/components/calendar/TeamMonthNotice';
import ConfigProvider from '@/components/ConfigProvider';
import HeaderNav from '@/components/HeaderNav';
import TeamComingSoonView from '@/components/team/TeamComingSoonView';
import UploadPanel from '@/components/upload/UploadPanel';
import { AppMode } from '@/domain/enums/AppMode';
import { AuthProviderType } from '@/domain/enums/AuthProviderType';
import { BillingMode } from '@/domain/enums/BillingMode';
import { CalendarMonthSource } from '@/domain/enums/CalendarMonthSource';
import { PaymentProviderType } from '@/domain/enums/PaymentProviderType';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { TeamMode } from '@/domain/enums/TeamMode';
import { VisionProviderType } from '@/domain/enums/VisionProviderType';
import { type PublicConfigResponse } from '@/domain/types/api/PublicConfigResponse';
import { type TeamMonthInfo } from '@/domain/types/api/TeamMonthInfo';
import { createEnvSandbox } from '../helpers/EnvSandbox';

/**
 * Smoke renders (react-dom/server) of every team entry point (Spec §24.2): in team "준비 중" mode no link
 * leads to `/teams` or `/join`; enabled mode keeps today's links.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/calendar',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const serverContext = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock('@/server/http/RequestContext', () => ({
  getServerComponentContext: async () => serverContext,
}));

const TEAM: TeamMonthInfo = {
  teamId: 'team-1',
  teamName: '달력 병동',
  revision: 2,
  publishedAt: '2026-10-01T00:00:00.000Z',
  changes: [{ date: '2026-11-03', fromCode: 'D', toCode: 'E' }],
  acknowledgedRevision: 1,
};

vi.mock('@/components/calendar/UseCalendarMonthState', () => ({
  useCalendarMonthState: () => ({
    loadState: ScreenLoadState.READY,
    loadError: null,
    summary: {
      calendar: { displayName: '이여름' },
      months: [
        {
          yearMonth: '2026-11',
          shareVisible: false,
          updatedAt: '2026-10-01T00:00:00.000Z',
          workCount: 0,
          offCount: 0,
          source: CalendarMonthSource.TEAM,
          team: TEAM,
          hasPersonalBackup: false,
        },
      ],
      share: { enabled: false, url: null, displayName: null },
      freeRemaining: 0,
      priceKrw: 990,
    },
    month: {
      yearMonth: '2026-11',
      displayName: '이여름',
      definitions: [],
      entries: [],
      revision: 2,
      updatedAt: '2026-10-01T00:00:00.000Z',
      shareVisible: false,
      source: CalendarMonthSource.TEAM,
      readOnly: true,
      team: TEAM,
      hasPersonalBackup: false,
    },
    selectedDate: null,
    actionError: null,
    isAcking: false,
    handleAckChanges: () => undefined,
  }),
}));

/** Any link into the team surface. */
const TEAM_LINK = /href="\/(teams|join)/;

const buildConfig = (teamMode: TeamMode): PublicConfigResponse => ({
  appMode: AppMode.LIVE,
  billingMode: BillingMode.BETA_FREE,
  teamMode,
  priceKrw: 990,
  freeMonthLimit: 2,
  authProviders: [AuthProviderType.KAKAO],
  paymentProvider: PaymentProviderType.MOCK,
  visionProvider: VisionProviderType.MOCK,
  isMockVision: true,
  isMockPayment: false,
  uploadMaxBytes: 10 * 1024 * 1024,
  sourceTtlHours: 24,
});

const renderWithConfig = (teamMode: TeamMode, element: ReactElement): string =>
  renderToStaticMarkup(
    createElement(
      ConfigProvider,
      { config: buildConfig(teamMode) } as ComponentProps<typeof ConfigProvider>,
      element,
    ),
  );

const renderBoth = (element: ReactElement): { soon: string; enabled: string } => ({
  soon: renderWithConfig(TeamMode.COMING_SOON, element),
  enabled: renderWithConfig(TeamMode.ENABLED, element),
});

const renderNotice = (isTeamComingSoon: boolean): string =>
  renderToStaticMarkup(
    createElement(TeamMonthNotice, {
      team: TEAM,
      hasPersonalBackup: false,
      isAcking: false,
      onAck: () => undefined,
      isTeamComingSoon,
    }),
  );

const envSandbox = createEnvSandbox();

afterEach(() => {
  envSandbox.restore();
  serverContext.user = null;
});

describe('team coming soon (smoke render)', () => {
  it('header menu: 달력 · 로그아웃 without 팀', () => {
    const { soon, enabled } = renderBoth(createElement(HeaderNav));

    expect(soon).toContain('달력');
    expect(soon).toContain('로그아웃');
    expect(soon).not.toMatch(TEAM_LINK);
    expect(soon).not.toContain('>팀<');
    expect(enabled).toContain('href="/teams"');
  });

  it('landing team section: 준비 중 chip, same description, no 팀 공유 알아보기', () => {
    const { soon, enabled } = renderBoth(createElement(UploadPanel, { isLoggedIn: false }));

    expect(soon).toMatch(/팀 전체가 함께 쓰려면<span class="soon-chip">준비 중<\/span><\/h2>/);
    expect(soon).toContain('근무표 담당자가 사진을 한 번 올리면 팀원 모두가 각자 달력을 받아요.');
    expect(soon).not.toContain('팀 공유 알아보기');
    expect(soon).not.toMatch(TEAM_LINK);
    expect(enabled).toContain('팀 공유 알아보기');
    expect(enabled).not.toContain('soon-chip');
  });

  it('upload (signed in): plain 팀 공유 · 준비 중 text instead of the link', () => {
    const { soon, enabled } = renderBoth(createElement(UploadPanel, { isLoggedIn: true }));

    expect(soon).toContain('<span class="tiny">팀 공유 · 준비 중</span>');
    expect(soon).not.toContain('팀으로 함께 쓰기');
    expect(soon).not.toMatch(TEAM_LINK);
    expect(enabled).toContain('팀으로 함께 쓰기');
  });

  it('calendar team month: read-only notice stays, no 내 팀 보기 or team screen link', () => {
    const { soon, enabled } = renderBoth(createElement(CalendarMonthView, { yearMonth: '2026-11' }));

    expect(soon).toContain('달력 병동 근무표');
    expect(soon).toContain('팀 관리자가 배포한 근무예요');
    expect(soon).not.toContain('내 팀 보기');
    expect(soon).not.toMatch(TEAM_LINK);
    expect(enabled).toContain('내 팀 보기');
    expect(enabled).toContain('href="/teams/team-1"');
  });

  it('team month notice: change notice without the ack button (team APIs are closed)', () => {
    const soon = renderNotice(true);

    expect(soon).toContain('근무가 바뀌었어요');
    expect(soon).not.toContain('확인했어요');
    expect(soon).not.toMatch(TEAM_LINK);
    expect(renderNotice(false)).toContain('확인했어요');
  });

  it('coming-soon screen: copy and the button by login state', () => {
    const loggedIn = renderToStaticMarkup(createElement(TeamComingSoonView, { isLoggedIn: true }));
    const loggedOut = renderToStaticMarkup(createElement(TeamComingSoonView, { isLoggedIn: false }));

    for (const html of [loggedIn, loggedOut]) {
      expect(html).toContain('팀 공유는 준비 중이에요');
      expect(html).toContain(
        '근무표 담당자가 한 번 올리면 팀원 모두가 각자 달력을 받는 기능을 준비하고 있어요.',
      );
    }

    expect(loggedIn).toContain('<a class="primary" href="/calendar">내 달력으로</a>');
    expect(loggedOut).toContain('<a class="primary" href="/">처음으로</a>');
  });

  it('teams/join layouts: page replaced in coming soon, untouched when enabled', async () => {
    envSandbox.set({ TEAM_MODE: 'coming_soon' });
    serverContext.user = { id: 'u1' };

    for (const Layout of [TeamsLayout, JoinLayout]) {
      const soon = renderToStaticMarkup(await Layout({ children: 'team page' }));

      expect(soon).toContain('팀 공유는 준비 중이에요');
      expect(soon).toContain('내 달력으로');
      expect(soon).not.toContain('team page');
    }

    envSandbox.set({ TEAM_MODE: 'enabled' });

    expect(await TeamsLayout({ children: 'team page' })).toBe('team page');
    expect(await JoinLayout({ children: 'team page' })).toBe('team page');
  });

  it('teams/join pages: no server work in coming soon (params never read)', async () => {
    envSandbox.set({ TEAM_MODE: 'coming_soon' });

    // Awaiting these params throws: a page that reads them (or anything after) fails the test.
    const params = {
      then: () => {
        throw new Error('page read its params in coming soon');
      },
    } as unknown as Promise<never>;

    expect(await TeamsPage()).toBeNull();
    expect(await TeamPage({ params })).toBeNull();
    expect(await TeamRosterPage({ params })).toBeNull();
    expect(await RosterPage({ params })).toBeNull();
    expect(await JoinPage({ params })).toBeNull();
  });

  it('every /teams/** and /join/** page checks coming soon itself', async () => {
    const pageFiles: string[] = [];

    for (const dir of ['src/app/teams', 'src/app/join']) {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });

      pageFiles.push(
        ...entries
          .filter((entry) => entry.isFile() && entry.name === 'page.tsx')
          .map((entry) => path.join(entry.parentPath, entry.name)),
      );
    }

    expect(pageFiles).toHaveLength(5);

    for (const file of pageFiles) {
      expect(await readFile(file, 'utf8'), file).toContain('isTeamComingSoon(getAppConfig())');
    }
  });
});
