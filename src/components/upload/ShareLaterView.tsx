'use client';

import { Send } from 'lucide-react';

import { SHARE_LATER_BUTTON_TEXT } from '@/client/ShareLater';
import { useShareLaterState } from '@/components/upload/UseShareLaterState';

type ShareLaterViewProps = {
  /** APP_URL + `?utm_source=share_later`, built on the server. */
  shareUrl: string;
};

/** Secondary "send the link for later" control under the upload box (Spec §26.4). */
const ShareLaterView = ({ shareUrl }: ShareLaterViewProps) => {
  const { message, isSharing, handleShareLater } = useShareLaterState(shareUrl);

  return (
    <div className="share-later">
      <button
        type="button"
        className="secondary share-later-button"
        onClick={handleShareLater}
        disabled={isSharing}
      >
        <Send size={16} aria-hidden="true" />
        {SHARE_LATER_BUTTON_TEXT}
      </button>
      <div className="status-line share-later-status" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
};

export default ShareLaterView;
