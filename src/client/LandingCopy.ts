import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import { ExportPanel } from '@/domain/enums/ExportPanel';

/** Copy for the signed-out service guide on the entry screen (Spec §17). No accuracy claims, no auto-sync promise. */

export type LandingCopySource = {
  freeMonthLimit: number;
  priceKrw: number;
  sourceTtlHours: number;
};

export type LandingStep = {
  title: string;
  description: string;
};

export type LandingShareMethod = {
  method: ExportPanel;
  title: string;
  description: string;
};

export type LandingFaq = {
  question: string;
  answer: string;
};

export const LANDING_STEPS_TITLE = '이렇게 써요';

export const LANDING_SHARE_TITLE = '이렇게 공유해요';

export const LANDING_RECIPIENT_TITLE = '공유받은 사람은';

export const LANDING_FAQ_TITLE = '자주 묻는 질문';

export const LANDING_STEPS: LandingStep[] = [
  {
    title: '근무표 사진 올리기',
    description: '표 전체와 날짜가 잘 보이게 찍은 사진 한 장이면 돼요.',
  },
  {
    title: '내 이름 고르고 근무 확인',
    description:
      '로그인하고 내 이름을 고르면 내 근무만 가져와요. 헷갈리는 칸은 ‘확인 필요’로 표시하니 확인하고 고쳐 주세요.',
  },
  {
    title: '저장하면 내 근무 달력 완성',
    description: '저장한 달력은 언제든 다시 보고 공유할 수 있어요.',
  },
];

export const LANDING_SHARE_METHODS: LandingShareMethod[] = [
  {
    method: ExportPanel.LINK,
    title: '링크로 공유',
    description: '보여줄 달을 고르고 링크를 보내요. 링크는 언제든 새로 만들거나 공유를 멈출 수 있어요.',
  },
  {
    method: ExportPanel.ICS,
    title: '내 캘린더에 추가',
    description:
      'ICS 파일로 휴대폰 캘린더에 한 번 가져와요. 나중에 근무가 바뀌어도 자동으로 반영되지는 않아요.',
  },
  {
    method: ExportPanel.PNG,
    title: '달력 이미지 저장',
    description: '카톡으로 보내거나 사진첩에 보관해요.',
  },
];

export const LANDING_RECIPIENT_POINTS: string[] = [
  '가입이나 로그인 없이 링크로 바로 볼 수 있어요.',
  '내가 공개한 달의 내 근무만 보여요. 동료 이름, 원본 사진, 수정 기능은 없어요.',
  '받은 사람도 달력 이미지를 저장하거나 자기 캘린더에 추가할 수 있어요.',
  '근무가 바뀌어 다시 저장하면 같은 링크에서 바로 확인할 수 있어요.',
];

/** 24 → "24시간" */
export const formatHours = (hours: number): string => `${hours}시간`;

const describeFreeMonths = ({ freeMonthLimit, priceKrw }: LandingCopySource): string => {
  const price = formatPrice(priceKrw);

  if (freeMonthLimit <= 0) {
    return `새로 저장하는 달마다 한 달분 ${price}이에요. 자동 결제는 없어요.`;
  }

  return `처음 저장하는 ${formatMonthCount(freeMonthLimit)}은 무료예요. 그다음부터는 새로 저장하는 달마다 한 달분 ${price}이고, 자동 결제는 없어요.`;
};

export const buildLandingFaqs = (source: LandingCopySource): LandingFaq[] => [
  {
    question: '무료로 몇 달 쓸 수 있나요?',
    answer: describeFreeMonths(source),
  },
  {
    question: '올린 원본 사진은 어떻게 되나요?',
    answer: `근무를 확인하고 저장하면 원본 사진을 삭제해요. 저장하지 않아도 올린 뒤 ${formatHours(source.sourceTtlHours)}이 지나면 자동으로 삭제되고, 공유 화면에는 원본 사진이 들어가지 않아요.`,
  },
  {
    question: '근무가 바뀌면 어떻게 하나요?',
    answer:
      '새 근무표 사진을 올리거나 달력에서 직접 고친 뒤 다시 저장하면 돼요. 이미 저장한 달은 추가 비용이 없고, 공유 링크에도 바로 반영돼요. 캘린더에 이미 추가한 일정은 자동으로 바뀌지 않아요.',
  },
  {
    question: '카카오톡으로 링크를 보내면 미리보기에 내 이름이 나오나요?',
    answer:
      '아니요. 미리보기에는 ‘공유받은 근무표’라는 고정 문구만 보이고, 이름이나 근무 내용은 나오지 않아요.',
  },
];
