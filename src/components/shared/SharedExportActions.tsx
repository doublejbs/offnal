'use client';

import { CalendarPlus, Image as ImageIcon } from 'lucide-react';

import ExportRow from '@/components/share/ExportRow';
import IcsExportFormView from '@/components/share/IcsExportFormView';
import SharedPngPanelView from '@/components/shared/SharedPngPanelView';
import { useSharedExportState } from '@/components/shared/UseSharedExportState';
import { ExportPanel } from '@/domain/enums/ExportPanel';
import { type SharedMonth } from '@/domain/types/api/SharedCalendarResponse';
import { filterUsedDefinitions } from '@/domain/UsedDefinitions';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type SharedExportActionsProps = {
  token: string;
  displayName: string;
  month: SharedMonth;
};

/** Recipient's exports of the viewed month (no login): month image and one-time calendar import. */
const SharedExportActions = ({ token, displayName, month }: SharedExportActionsProps) => {
  const state = useSharedExportState(token, displayName, month);
  const monthLabel = formatYearMonthLabel(month.yearMonth);

  return (
    <section className="mt-16" aria-label={`${monthLabel} 근무 내보내기`}>
      <ExportRow
        panel={ExportPanel.PNG}
        openPanel={state.openPanel}
        icon={<ImageIcon size={20} aria-hidden="true" />}
        title="달력 이미지 저장"
        description={`${monthLabel} 달력을 사진첩에 보관`}
        onToggle={state.handleToggle}
      >
        <SharedPngPanelView
          displayName={displayName}
          monthLabel={monthLabel}
          isBusy={state.busyPanel !== null}
          error={state.error}
          message={state.message}
          onSave={state.handleSavePng}
        />
      </ExportRow>
      <ExportRow
        panel={ExportPanel.ICS}
        openPanel={state.openPanel}
        icon={<CalendarPlus size={20} aria-hidden="true" />}
        title="내 캘린더에 추가"
        description={`${monthLabel} 출퇴근 시간을 내 캘린더에서 확인`}
        onToggle={state.handleToggle}
      >
        <IcsExportFormView
          usedDefinitions={filterUsedDefinitions(month.definitions, month.entries)}
          includeOff={state.includeOff}
          onChangeIncludeOff={state.setIncludeOff}
          isBusy={state.busyPanel !== null}
          error={state.error}
          message={state.message}
          onDownload={state.handleDownloadIcs}
          openSupport={state.icsOpenSupport}
        />
      </ExportRow>
    </section>
  );
};

export default SharedExportActions;
