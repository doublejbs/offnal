'use client';

import { useId } from 'react';

import { describeBlocker, describeMonthAccess, formatMonthCount } from '@/client/DisplayText';
import { usePublicConfig } from '@/components/ConfigProvider';
import { type DraftPublish } from '@/components/draft/UseDraftPublish';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { type MonthAccessInfo } from '@/domain/types/api/MonthAccessInfo';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';

type PublishPanelProps = {
  access: MonthAccessInfo;
  blockers: PublishBlocker[];
  needsTimeConfirmation: boolean;
  canPublish: boolean;
  publish: DraftPublish;
  onSelectBlocker: (blocker: PublishBlocker) => void;
  onSelectTimeConfirmation: () => void;
};

const getButtonLabel = (access: MonthAccessInfo, paymentText: string): string => {
  if (access.monthAccess === MonthAccess.PAYMENT_REQUIRED) {
    return paymentText;
  }

  return access.monthAccess === MonthAccess.TRIAL_AVAILABLE ? '확인하고 무료로 저장' : '확인하고 저장';
};

/** Save button, the reasons it is disabled (each one jumps to what needs fixing) and the access text. */
const PublishPanel = ({
  access,
  blockers,
  needsTimeConfirmation,
  canPublish,
  publish,
  onSelectBlocker,
  onSelectTimeConfirmation,
}: PublishPanelProps) => {
  const { freeMonthLimit } = usePublicConfig();
  const blockersId = useId();
  const description = describeMonthAccess(access, freeMonthLimit);
  const hasReasons = blockers.length > 0 || needsTimeConfirmation;

  return (
    <section aria-label="저장" className="mt-20">
      {hasReasons && (
        <div className="warning" id={blockersId}>
          저장하려면 아래 항목을 확인해 주세요.
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker.reason}>
                <button type="button" className="linkish" onClick={() => onSelectBlocker(blocker)}>
                  {describeBlocker(blocker)}
                </button>
              </li>
            ))}
            {needsTimeConfirmation && (
              <li>
                <button type="button" className="linkish" onClick={onSelectTimeConfirmation}>
                  인식된 근무 시간이 맞는지 확인해 주세요
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      {publish.publishError && (
        <div className="warning" role="alert">
          {publish.publishError}
          {publish.isStaleBase && (
            <button type="button" className="secondary mt-10" onClick={publish.handleRestartFromPublished}>
              최신 달력으로 다시 수정하기
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="primary"
        disabled={!canPublish || publish.isPublishing}
        aria-describedby={hasReasons ? blockersId : undefined}
        onClick={publish.handlePublish}
      >
        {publish.isPublishing ? '저장하는 중…' : getButtonLabel(access, description.text)}
      </button>
      <div className="hint">
        {description.requiresPayment
          ? `무료 ${formatMonthCount(freeMonthLimit)}을 모두 이용했어요 · 단건 구매, 자동 결제 없음`
          : description.text}
      </div>
    </section>
  );
};

export default PublishPanel;
