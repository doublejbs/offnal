import { type AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';

export type Percentiles = { p50: number | null; p95: number | null };

/**
 * Personal upload cohort (Spec §23.5, §23.7): jobs uploaded in the window (team roster uploads excluded),
 * each stage counting those jobs that reached it by the report time.
 */
export type FunnelCounts = {
  uploaded: number;
  recognized: number;
  claimed: number;
  drafted: number;
  published: number;
};

export type FunnelStep = {
  label: string;
  count: number;
  /** Share of the previous stage (null for the first stage or an empty previous stage). */
  fromPrevious: number | null;
  /** Share of the first stage. */
  fromStart: number | null;
};

export type DailyEventCount = { date: string; event: AnalyticsEvent; count: number };

/** Entry-screen event counts (Spec §26.5): plain event counts, the client events carry no job to follow. */
export type LandingCounts = {
  uploadClicked: number;
  /** Personal `upload_started` (team roster uploads excluded). */
  uploads: number;
  sampleStarted: number;
  sampleCompleted: number;
  sampleCtaClicked: number;
  shareLaterClicked: number;
  shareLaterShared: number;
  shareLaterCopied: number;
  loginClicked: number;
  loginClickedLanding: number;
  loginClickedGate: number;
  loginCompleted: number;
  loginFailed: number;
};

export type LandingReport = {
  all: LandingCounts;
  /** `inApp = true`: Instagram/Facebook in-app browser. */
  inApp: LandingCounts;
  /** `inApp = false`. Events recorded before `inApp` existed are only in `all`. */
  notInApp: LandingCounts;
};

export const emptyLandingCounts = (): LandingCounts => ({
  uploadClicked: 0,
  uploads: 0,
  sampleStarted: 0,
  sampleCompleted: 0,
  sampleCtaClicked: 0,
  shareLaterClicked: 0,
  shareLaterShared: 0,
  shareLaterCopied: 0,
  loginClicked: 0,
  loginClickedLanding: 0,
  loginClickedGate: 0,
  loginCompleted: 0,
  loginFailed: 0,
});

export type AnalyticsReportData = {
  days: number;
  funnel: FunnelCounts;
  /** Team roster uploads in the window (kept out of the personal funnel). */
  team: { uploaded: number; recognized: number };
  quality: {
    /** AI drafts (manual drafts excluded). */
    drafts: number;
    reviewCells: Percentiles;
    /** `review_completed` events (publishes of AI drafts). */
    reviews: number;
    editedCells: Percentiles;
    fullMonthMatches: number;
  };
  secondMonth: {
    /** Users with at least one `month_published`. */
    publishers: number;
    /** Of those, users who published a second distinct month (monthIndex ≥ 2). */
    repeatPublishers: number;
  };
  share: {
    /** Users whose latest share setting shows at least one month. */
    sharers: number;
    /** Distinct (shared calendar, Seoul day) pairs: month switches on one visit count once. */
    sharedViewDays: number;
    /** Distinct shared calendars viewed. */
    sharedLinks: number;
  };
  activity: {
    dailyActive: { date: string; users: number }[];
    /** Distinct actors in the last 7 days of the period. */
    weeklyActive: number;
  };
  retention: {
    /** Users whose first publish is at least 7 days before the period end. */
    eligible: number;
    /** Of those, users with a `calendar_viewed` on a later (Seoul) day within 7 days. */
    retained: number;
  };
  daily: DailyEventCount[];
  landing: LandingReport;
};

const FUNNEL_LABELS: [keyof FunnelCounts, string][] = [
  ['uploaded', '업로드'],
  ['recognized', '인식 성공'],
  ['claimed', '로그인 연결(가져감·로그인 후 업로드)'],
  ['drafted', '초안'],
  ['published', '발행'],
];

export const toRate = (count: number, total: number): number | null => (total === 0 ? null : count / total);

export const formatRate = (rate: number | null): string =>
  rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;

const formatNumber = (value: number | null): string => (value === null ? '—' : String(value));

const formatPercentiles = (value: Percentiles): string =>
  `p50 ${formatNumber(value.p50)} · p95 ${formatNumber(value.p95)}`;

export const buildFunnel = (counts: FunnelCounts): FunnelStep[] => {
  const start = counts.uploaded;

  return FUNNEL_LABELS.map(([key, label], index) => {
    const previousKey = index === 0 ? null : FUNNEL_LABELS[index - 1]![0];

    return {
      label,
      count: counts[key],
      fromPrevious: previousKey === null ? null : toRate(counts[key], counts[previousKey]),
      fromStart: toRate(counts[key], start),
    };
  });
};

/** Dates (ascending) × events (first appearance order), zeros where an event had no rows that day. */
export const pivotDailyCounts = (
  rows: DailyEventCount[],
): { dates: string[]; events: AnalyticsEvent[]; counts: number[][] } => {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const events = [...new Set(rows.map((row) => row.event))];
  const byKey = new Map(rows.map((row) => [`${row.date}|${row.event}`, row.count]));
  const counts = dates.map((date) => events.map((event) => byKey.get(`${date}|${event}`) ?? 0));

  return { dates, events, counts };
};

const formatFunnel = (counts: FunnelCounts): string[] =>
  buildFunnel(counts).map(
    (step) =>
      `  ${step.label}: ${step.count}건 (이전 단계 대비 ${formatRate(step.fromPrevious)}, 업로드 대비 ${formatRate(step.fromStart)})`,
  );

const formatDaily = (rows: DailyEventCount[]): string[] => {
  if (rows.length === 0) {
    return ['  이벤트 없음'];
  }

  const { dates, events, counts } = pivotDailyCounts(rows);

  return [
    `  날짜        ${events.join(' ')}`,
    ...dates.map((date, index) => `  ${date}  ${(counts[index] ?? []).join(' ')}`),
  ];
};

/** "10 → 업로드 3 (30.0%)": a count followed by the next step and its share of the previous one. */
const formatStep = (label: string, count: number, previous: number): string =>
  `${label} ${count} (${formatRate(toRate(count, previous))})`;

const formatLandingGroup = (title: string, counts: LandingCounts): string[] => [
  `  ${title}`,
  `    사진 선택 누름 ${counts.uploadClicked} → ${formatStep('업로드', counts.uploads, counts.uploadClicked)}`,
  `    예시 체험 시작 ${counts.sampleStarted} → ${formatStep('완료', counts.sampleCompleted, counts.sampleStarted)} → ${formatStep('내 근무표로 만들기', counts.sampleCtaClicked, counts.sampleCompleted)}`,
  `    나중에 하기 누름 ${counts.shareLaterClicked} (공유 ${counts.shareLaterShared} · 복사 ${counts.shareLaterCopied})`,
  `    로그인 누름 ${counts.loginClicked} (첫 화면 ${counts.loginClickedLanding} · 게이트 ${counts.loginClickedGate}) → ${formatStep('성공', counts.loginCompleted, counts.loginClicked)} · 실패 ${counts.loginFailed}`,
];

const formatLanding = (landing: LandingReport): string[] => [
  '첫 화면 깔때기 (기간 안 이벤트 건수 · 방문 수는 Vercel 대시보드에서, 업로드·로그인 성공은 모든 경로 포함)',
  ...formatLandingGroup('전체', landing.all),
  ...formatLandingGroup('앱 안 브라우저(인스타그램·페이스북)', landing.inApp),
  ...formatLandingGroup('일반 브라우저', landing.notInApp),
];

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Readable Korean summary of `pnpm analytics:report` (numbers and pseudonymous aggregates only). */
export const formatAnalyticsReport = (data: AnalyticsReportData): string => {
  const { quality, secondMonth, share, activity, retention } = data;
  const dailyAverage = average(activity.dailyActive.map((day) => day.users));
  const latestDay = activity.dailyActive.at(-1);

  return [
    `[analytics:report] 최근 ${data.days}일`,
    '',
    '개인 깔때기 (업로드 코호트: 기간 안에 올린 작업, 이후 단계는 지금까지)',
    ...formatFunnel(data.funnel),
    `  팀 근무표 업로드: ${data.team.uploaded}건 (인식 성공 ${data.team.recognized}건, 깔때기 제외)`,
    '',
    '인식 품질',
    `  초안 ${quality.drafts}건 — 확인 필요 칸 ${formatPercentiles(quality.reviewCells)}`,
    `  발행 ${quality.reviews}건 — 수정 칸 ${formatPercentiles(quality.editedCells)}`,
    `  월 전체 일치율: ${formatRate(toRate(quality.fullMonthMatches, quality.reviews))} (${quality.fullMonthMatches}/${quality.reviews})`,
    '',
    '재사용·공유',
    `  두 번째 달 등록률: ${formatRate(toRate(secondMonth.repeatPublishers, secondMonth.publishers))} (${secondMonth.repeatPublishers}/${secondMonth.publishers}명)`,
    `  공유 켠 사용자: ${share.sharers}명, 공유 열람(링크·일 기준): ${share.sharedViewDays}회, 열람된 링크: ${share.sharedLinks}개`,
    `  공유 링크당 열람(링크·일 기준): ${share.sharedLinks === 0 ? '—' : (share.sharedViewDays / share.sharedLinks).toFixed(1)}`,
    '',
    '활성 사용자 (본인이 한 행동 기준: 팀 승인·결제 웹훅 제외)',
    `  일 활성(평균): ${dailyAverage === null ? '—' : `${dailyAverage.toFixed(1)}명`}, 마지막 날(${latestDay?.date ?? '—'}): ${latestDay?.users ?? 0}명`,
    `  주 활성(마지막 7일): ${activity.weeklyActive}명`,
    `  7일 재방문율: ${formatRate(toRate(retention.retained, retention.eligible))} (${retention.retained}/${retention.eligible}명, 첫 발행 후 7일이 지난 사용자 기준)`,
    '',
    ...formatLanding(data.landing),
    '',
    '이벤트별 일자 건수 (서울 기준)',
    ...formatDaily(data.daily),
  ].join('\n');
};
