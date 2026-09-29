'use client';

import { describeBlocker, describeMonthAccess, formatMonthCount } from '@/client/DisplayText';
import { usePublicConfig } from '@/components/ConfigProvider';
import { type DraftPublish } from '@/components/draft/UseDraftPublish';
import { MonthAccess } from '@/domain/enums/MonthAccess';
import { type MonthAccessInfo } from '@/domain/types/api/MonthAccessInfo';
import { type PublishBlocker } from '@/domain/types/PublishBlocker';

type PublishPanelProps = {
  access: MonthAccessInfo;
  blockers: PublishBlocker[];
  publish: DraftPublish;
  isBlockedBySave: boolean;
  onSelectBlocker: (blocker: PublishBlocker) => void;
};

const getButtonLabel = (access: MonthAccessInfo, paymentText: string): string => {
  if (access.monthAccess === MonthAccess.PAYMENT_REQUIRED) {
    return paymentText;
  }

  return access.monthAccess === MonthAccess.TRIAL_AVAILABLE ? '확인하고 무료로 저장' : '확인하고 저장';
};

/** Save button, the reasons it is disabled (each one jumps to the affected date) and the access text. */
const PublishPanel = ({ access, blockers, publish, isBlockedBySave, onSelectBlocker }: PublishPanelProps) => {
  const { freeMonthLimit } = usePublicConfig();
  const description = describeMonthAccess(access, freeMonthLimit);
  const isDisabled = blockers.length > 0 || isBlockedBySave || publish.isPublishing;

  return (
    <section aria-label="저장" style={{ marginTop: 20 }}>
      {blockers.length > 0 && (
        <div className="warning" id="publish-blockers">
          저장하려면 아래 항목을 확인해 주세요.
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker.reason}>
                <button type="button" className="linkish" onClick={() => onSelectBlocker(blocker)}>
                  {describeBlocker(blocker)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {publish.publishError && (
        <div className="warning" role="alert">
          {publish.publishError}
          {publish.isStaleBase && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="secondary" onClick={publish.handleRestartFromPublished}>
                최신 달력으로 다시 수정하기
              </button>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="primary"
        disabled={isDisabled}
        aria-describedby={blockers.length > 0 ? 'publish-blockers' : undefined}
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
