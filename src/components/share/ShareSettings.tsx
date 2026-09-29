'use client';

import { Copy, Share2 } from 'lucide-react';

import ConfirmDialog from '@/components/ConfirmDialog';
import LoadingState from '@/components/LoadingState';
import { useShareSettingsState } from '@/components/share/UseShareSettingsState';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { ShareConfirmAction } from '@/domain/enums/ShareConfirmAction';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type ShareSettingsProps = {
  yearMonth: string;
  fallbackName: string;
};

/** Read-only link: display name, which published months it shows, share/copy, rotate and stop. */
const ShareSettings = ({ yearMonth, fallbackName }: ShareSettingsProps) => {
  const state = useShareSettingsState(yearMonth, fallbackName);
  const { settings } = state;

  if (state.loadState === ScreenLoadState.LOADING) {
    return <LoadingState text="공유 설정을 불러오는 중이에요…" />;
  }

  if (state.loadState !== ScreenLoadState.READY || !settings) {
    return (
      <div className="warning" role="alert">
        {state.loadError}
      </div>
    );
  }

  const months = settings.availableMonths.length > 0 ? settings.availableMonths : [yearMonth];

  return (
    <div>
      <label className="field" style={{ marginTop: 0 }}>
        표시 이름
        <input
          value={state.displayName}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          onChange={(event) => state.setDisplayName(event.target.value)}
        />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend style={{ fontSize: 14, marginBottom: 4 }}>공개할 달</legend>
        {months.map((month) => (
          <label key={month} className="check">
            <input
              type="checkbox"
              checked={state.visibleMonths.includes(month)}
              onChange={(event) => state.handleToggleMonth(month, event.target.checked)}
            />
            {formatYearMonthLabel(month)}
          </label>
        ))}
      </fieldset>
      <div className="notice">링크를 가진 사람은 누구나 볼 수 있고 다시 전달할 수 있어요.</div>
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <button type="button" className="primary" onClick={state.handleSave} disabled={!state.canSave}>
        {state.isBusy ? '저장하는 중…' : settings.enabled ? '저장하고 링크 공유' : '공유 링크 만들기'}
      </button>
      {state.visibleMonths.length === 0 && <div className="hint">공개할 달을 하나 이상 선택해 주세요.</div>}
      <div className="status-line" role="status" aria-live="polite" style={{ marginTop: 8 }}>
        {state.message}
      </div>
      {settings.enabled && settings.url && (
        <>
          <div className="copy-field">
            <input
              readOnly
              value={settings.url}
              aria-label="공유 링크"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="링크 공유 또는 복사"
              onClick={() => settings.url && state.handleShareUrl(settings.url)}
            >
              {typeof navigator !== 'undefined' && 'share' in navigator ? (
                <Share2 size={18} aria-hidden="true" />
              ) : (
                <Copy size={18} aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="actionrow">
            <button
              type="button"
              className="secondary"
              disabled={state.isBusy}
              onClick={() => state.setConfirmAction(ShareConfirmAction.ROTATE)}
            >
              링크 재발급
            </button>
            <button
              type="button"
              className="danger"
              disabled={state.isBusy}
              onClick={() => state.setConfirmAction(ShareConfirmAction.STOP)}
            >
              공유 중지
            </button>
          </div>
          <div className="hint">이미 저장된 이미지나 일정 파일은 링크를 바꿔도 회수되지 않아요.</div>
        </>
      )}
      <ConfirmDialog
        isOpen={state.confirmAction !== ShareConfirmAction.NONE}
        title={
          state.confirmAction === ShareConfirmAction.STOP ? '공유를 중지할까요?' : '링크를 다시 만들까요?'
        }
        message={
          state.confirmAction === ShareConfirmAction.STOP
            ? '지금 링크로는 더 이상 달력을 볼 수 없어요. 다시 공유하면 새 링크가 만들어져요.'
            : '지금까지 보낸 링크는 바로 열리지 않게 돼요. 새 링크를 다시 보내 주세요.'
        }
        confirmLabel={state.confirmAction === ShareConfirmAction.STOP ? '공유 중지' : '재발급'}
        isDanger={state.confirmAction === ShareConfirmAction.STOP}
        isBusy={state.isBusy}
        onConfirm={state.handleConfirm}
        onCancel={() => state.setConfirmAction(ShareConfirmAction.NONE)}
      />
    </div>
  );
};

export default ShareSettings;
