'use client';

import { Copy, Share2 } from 'lucide-react';

import { ShareConfirmAction } from '@/domain/enums/ShareConfirmAction';

type ShareLinkActionsProps = {
  url: string;
  canShare: boolean;
  isBusy: boolean;
  onShare: (url: string) => void;
  onCopy: (url: string) => void;
  onRequestConfirm: (action: ShareConfirmAction) => void;
};

/**
 * The existing link: selectable text (fallback), 공유하기 calling navigator.share straight from the
 * click (keeps the user gesture), copy, rotate and stop.
 */
const ShareLinkActions = ({
  url,
  canShare,
  isBusy,
  onShare,
  onCopy,
  onRequestConfirm,
}: ShareLinkActionsProps) => (
  <>
    <input
      className="mt-8"
      readOnly
      value={url}
      aria-label="공유 링크"
      onFocus={(event) => event.currentTarget.select()}
    />
    <div className="actionrow">
      {canShare && (
        <button type="button" className="primary" onClick={() => onShare(url)}>
          <Share2 size={18} aria-hidden="true" />
          공유하기
        </button>
      )}
      <button type="button" className={canShare ? 'secondary' : 'primary'} onClick={() => onCopy(url)}>
        <Copy size={18} aria-hidden="true" />
        링크 복사
      </button>
    </div>
    <div className="actionrow">
      <button
        type="button"
        className="secondary"
        disabled={isBusy}
        onClick={() => onRequestConfirm(ShareConfirmAction.ROTATE)}
      >
        링크 재발급
      </button>
      <button
        type="button"
        className="danger"
        disabled={isBusy}
        onClick={() => onRequestConfirm(ShareConfirmAction.STOP)}
      >
        공유 중지
      </button>
    </div>
    <div className="hint">이미 저장된 이미지나 일정 파일은 링크를 바꿔도 회수되지 않아요.</div>
  </>
);

export default ShareLinkActions;
