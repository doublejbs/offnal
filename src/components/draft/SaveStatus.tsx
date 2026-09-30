import { DraftSaveState } from '@/domain/enums/DraftSaveState';

type SaveStatusProps = {
  saveState: DraftSaveState;
  saveMessage: string | null;
  onRetry: () => void;
  onReload: () => void;
};

const STATE_TEXT: Record<DraftSaveState, string> = {
  [DraftSaveState.IDLE]: '',
  [DraftSaveState.PENDING]: '저장 대기 중',
  [DraftSaveState.SAVING]: '저장 중…',
  [DraftSaveState.SAVED]: '저장됨',
  [DraftSaveState.INVALID]: '저장 안 됨',
  [DraftSaveState.CONFLICT]: '다른 곳에서 수정됐어요',
  [DraftSaveState.ERROR]: '저장하지 못했어요',
};

/** Autosave indicator (text, not color only) with recovery actions for conflicts and failures. */
const SaveStatus = ({ saveState, saveMessage, onRetry, onReload }: SaveStatusProps) => {
  const isProblem =
    saveState === DraftSaveState.CONFLICT ||
    saveState === DraftSaveState.ERROR ||
    saveState === DraftSaveState.INVALID;

  return (
    <div role="status" aria-live="polite">
      {!isProblem && <div className="status-line">{STATE_TEXT[saveState]}</div>}
      {isProblem && (
        <div className="warning">
          <strong>{STATE_TEXT[saveState]}</strong>
          {saveMessage && <div>{saveMessage}</div>}
          {saveState === DraftSaveState.CONFLICT && (
            <button type="button" className="secondary mt-10" onClick={onReload}>
              최신 내용 불러오기
            </button>
          )}
          {saveState === DraftSaveState.ERROR && (
            <button type="button" className="secondary mt-10" onClick={onRetry}>
              다시 저장
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SaveStatus;
