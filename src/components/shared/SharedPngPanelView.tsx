import ExportFeedbackView from '@/components/share/ExportFeedbackView';

type SharedPngPanelViewProps = {
  displayName: string;
  monthLabel: string;
  isBusy: boolean;
  error: string | null;
  message: string | null;
  onSave: () => void;
};

/** Recipient's "save month image" panel; the calendar above already serves as the preview. */
const SharedPngPanelView = ({
  displayName,
  monthLabel,
  isBusy,
  error,
  message,
  onSave,
}: SharedPngPanelViewProps) => (
  <div>
    <p className="mt-0">
      {displayName}님의 {monthLabel} 근무를 이미지로 저장해요.
    </p>
    <ExportFeedbackView error={error} message={message}>
      <button type="button" className="primary" onClick={onSave} disabled={isBusy}>
        {isBusy ? '이미지를 만드는 중…' : '이미지 저장'}
      </button>
    </ExportFeedbackView>
    <div className="hint">저장된 이미지는 이후 근무 변경이 반영되지 않아요.</div>
  </div>
);

export default SharedPngPanelView;
