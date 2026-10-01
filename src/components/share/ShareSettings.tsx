'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import ShareLinkActions from '@/components/share/ShareLinkActions';
import { useShareSettingsState } from '@/components/share/UseShareSettingsState';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { ShareConfirmAction } from '@/domain/enums/ShareConfirmAction';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type ShareSettingsProps = {
  yearMonth: string;
  fallbackName: string;
};

const isStop = (action: ShareConfirmAction): boolean => action === ShareConfirmAction.STOP;

/** Read-only link: display name, which published months it shows, then share/copy, rotate and stop. */
const ShareSettings = ({ yearMonth, fallbackName }: ShareSettingsProps) => {
  const state = useShareSettingsState(yearMonth, fallbackName);
  const { settings, settingsLoad } = state;

  if (settingsLoad.state === ScreenLoadState.LOADING) {
    return <LoadingState text="공유 설정을 불러오는 중이에요…" />;
  }

  if (settingsLoad.state !== ScreenLoadState.READY || !settings) {
    return (
      <RecoverableError
        title="공유 설정을 불러오지 못했어요"
        message={settingsLoad.errorMessage ?? '잠시 후 다시 시도해 주세요.'}
        onRetry={settingsLoad.reload}
      />
    );
  }

  const months = settings.availableMonths.length > 0 ? settings.availableMonths : [yearMonth];

  return (
    <div>
      <label className="field mt-0">
        표시 이름
        <input
          value={state.displayName}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          onChange={(event) => state.setDisplayName(event.target.value)}
        />
      </label>
      <fieldset className="plain-fieldset">
        <legend className="text-14 mb-4">공개할 달</legend>
        {months.map((month) => (
          <label key={month} className="check">
            <input
              type="checkbox"
              checked={state.visibleMonths.includes(month)}
              onChange={(event) => state.handleToggleMonth(month, event.target.checked)}
            />
            {formatYearMonthLabel(month)}
            {settings.teamMonths.includes(month) && <span className="tiny"> · 팀 근무표</span>}
          </label>
        ))}
      </fieldset>
      {!settings.enabled && state.visibleMonths.length > 0 && (
        <div className="hint text-left">
          링크를 만들면 {state.visibleMonths.map(formatYearMonthLabel).join(', ')}만 공개돼요. 나중에 등록하는
          달은 자동으로 공개되지 않아요.
        </div>
      )}
      <div className="notice">링크를 가진 사람은 누구나 볼 수 있고 다시 전달할 수 있어요.</div>
      {state.error && (
        <div className="warning" role="alert">
          {state.error}
        </div>
      )}
      <button
        type="button"
        className={settings.enabled ? 'secondary' : 'primary'}
        onClick={state.handleSave}
        disabled={!state.canSave}
      >
        {state.isBusy ? '저장하는 중…' : settings.enabled ? '공유 설정 저장' : '공유 링크 만들기'}
      </button>
      {state.visibleMonths.length === 0 && <div className="hint">공개할 달을 하나 이상 선택해 주세요.</div>}
      <div className="status-line mt-8" role="status" aria-live="polite">
        {state.message}
      </div>
      {settings.enabled && settings.url && (
        <ShareLinkActions
          url={settings.url}
          canShare={state.canShare}
          isBusy={state.isBusy}
          onShare={state.handleShareUrl}
          onCopy={state.handleCopyUrl}
          onRequestConfirm={state.setConfirmAction}
        />
      )}
      <ConfirmDialog
        isOpen={state.confirmAction !== ShareConfirmAction.NONE}
        title={isStop(state.confirmAction) ? '공유를 중지할까요?' : '링크를 다시 만들까요?'}
        message={
          isStop(state.confirmAction)
            ? '지금 링크로는 더 이상 달력을 볼 수 없어요. 다시 공유하면 새 링크가 만들어져요.'
            : '지금까지 보낸 링크는 바로 열리지 않게 돼요. 새 링크를 다시 보내 주세요.'
        }
        confirmLabel={isStop(state.confirmAction) ? '공유 중지' : '재발급'}
        isDanger={isStop(state.confirmAction)}
        isBusy={state.isBusy}
        onConfirm={state.handleConfirm}
        onCancel={() => state.setConfirmAction(ShareConfirmAction.NONE)}
      />
    </div>
  );
};

export default ShareSettings;
