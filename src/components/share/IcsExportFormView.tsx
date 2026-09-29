import { formatDefinitionSummary } from '@/client/DisplayText';
import ExportFeedbackView from '@/components/share/ExportFeedbackView';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';

type IcsExportFormViewProps = {
  usedDefinitions: ShiftDefinition[];
  includeOff: boolean;
  onChangeIncludeOff: (includeOff: boolean) => void;
  isBusy: boolean;
  error: string | null;
  message: string | null;
  onDownload: () => void;
};

/** One-time ICS import form (never described as sync), shared by the owner and share-link recipients. */
const IcsExportFormView = ({
  usedDefinitions,
  includeOff,
  onChangeIncludeOff,
  isBusy,
  error,
  message,
  onDownload,
}: IcsExportFormViewProps) => (
  <div>
    <div className="block mt-0">
      <h2>출퇴근 시간을 함께</h2>
      <p>
        {usedDefinitions.map((definition) => (
          <span key={definition.code} className="block-text">
            {formatDefinitionSummary(definition)}
          </span>
        ))}
      </p>
    </div>
    <label className="check">
      <input
        type="checkbox"
        checked={includeOff}
        onChange={(event) => onChangeIncludeOff(event.target.checked)}
      />
      휴무도 종일 일정으로 추가
    </label>
    <div className="notice">
      한 번 가져오는 방식이에요. 이후 근무 변경은 자동 반영되지 않아요. 다시 가져오면 일정이 중복될 수 있어요.
    </div>
    <ExportFeedbackView error={error} message={message}>
      <button type="button" className="primary" onClick={onDownload} disabled={isBusy}>
        {isBusy ? '파일을 만드는 중…' : '일정 파일 받기'}
      </button>
    </ExportFeedbackView>
    <div className="hint">ICS 형식 · 한국 시간 기준</div>
  </div>
);

export default IcsExportFormView;
