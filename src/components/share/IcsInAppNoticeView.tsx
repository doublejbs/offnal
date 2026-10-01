import { Copy } from 'lucide-react';

type IcsInAppNoticeViewProps = {
  notice: string;
  copyMessage: string | null;
  fallbackUrl: string | null;
  onCopyPageUrl: () => void;
};

/** In-app browsers cannot import calendars: how to reopen in Safari / another browser + URL copy. */
const IcsInAppNoticeView = ({ notice, copyMessage, fallbackUrl, onCopyPageUrl }: IcsInAppNoticeViewProps) => (
  <div className="warning" role="alert">
    {notice}
    <button type="button" className="secondary mt-8" onClick={onCopyPageUrl}>
      <Copy size={18} aria-hidden="true" />이 페이지 주소 복사
    </button>
    {copyMessage && (
      <div className="status-line mt-8" role="status">
        {copyMessage}
      </div>
    )}
    {fallbackUrl && (
      <input
        className="mt-8"
        readOnly
        value={fallbackUrl}
        aria-label="이 페이지 주소"
        onFocus={(event) => event.currentTarget.select()}
      />
    )}
  </div>
);

export default IcsInAppNoticeView;
