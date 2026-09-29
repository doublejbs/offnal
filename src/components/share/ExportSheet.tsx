'use client';

import { CalendarPlus, Image as ImageIcon, Link as LinkIcon } from 'lucide-react';
import { useState } from 'react';

import { getCalendarMonth } from '@/client/ApiClient';
import AuthRequired from '@/components/AuthRequired';
import BackLink from '@/components/BackLink';
import LoadingState from '@/components/LoadingState';
import RecoverableError from '@/components/RecoverableError';
import ExportRow from '@/components/share/ExportRow';
import IcsExportPanel from '@/components/share/IcsExportPanel';
import PngExportPanel from '@/components/share/PngExportPanel';
import ShareSettings from '@/components/share/ShareSettings';
import { useLoad } from '@/components/UseLoad';
import { ExportPanel } from '@/domain/enums/ExportPanel';
import { ScreenLoadState } from '@/domain/enums/ScreenLoadState';
import { formatYearMonthLabel } from '@/domain/YearMonth';

type ExportSheetProps = {
  yearMonth: string;
};

/** The three export actions in one place; each expands its own panel. */
const ExportSheet = ({ yearMonth }: ExportSheetProps) => {
  const monthLoad = useLoad(yearMonth, (signal) => getCalendarMonth(yearMonth, signal));
  const [openPanel, setOpenPanel] = useState<ExportPanel | null>(null);
  const month = monthLoad.data;

  const handleToggle = (panel: ExportPanel) => setOpenPanel((current) => (current === panel ? null : panel));

  if (monthLoad.state === ScreenLoadState.LOADING) {
    return <LoadingState />;
  }

  if (monthLoad.state === ScreenLoadState.AUTH_REQUIRED) {
    return <AuthRequired returnTo={`/calendar/${yearMonth}/share`} />;
  }

  if (monthLoad.state !== ScreenLoadState.READY || !month) {
    return (
      <RecoverableError
        title="달력을 불러오지 못했어요"
        message={monthLoad.errorMessage ?? '다시 시도해 주세요.'}
        onRetry={monthLoad.state === ScreenLoadState.ERROR ? monthLoad.reload : undefined}
        alternativeHref="/calendar"
        alternativeLabel="내 달력으로"
      />
    );
  }

  return (
    <>
      <BackLink href={`/calendar/${yearMonth}`} />
      <div className="label">
        {formatYearMonthLabel(yearMonth)} · {month.displayName}
      </div>
      <h1>
        내 일정을
        <br />
        편한 방식으로.
      </h1>
      <p>함께 보는 사람은 가입하지 않아도 돼요.</p>
      <ExportRow
        panel={ExportPanel.LINK}
        openPanel={openPanel}
        icon={<LinkIcon size={20} aria-hidden="true" />}
        title="링크로 공유"
        description="근무가 바뀌어도 같은 링크에서 확인"
        onToggle={handleToggle}
      >
        <ShareSettings yearMonth={yearMonth} fallbackName={month.displayName} />
      </ExportRow>
      <ExportRow
        panel={ExportPanel.ICS}
        openPanel={openPanel}
        icon={<CalendarPlus size={20} aria-hidden="true" />}
        title="내 캘린더에 추가"
        description="약속과 출퇴근 시간을 한곳에서 확인"
        onToggle={handleToggle}
      >
        <IcsExportPanel yearMonth={yearMonth} definitions={month.definitions} entries={month.entries} />
      </ExportRow>
      <ExportRow
        panel={ExportPanel.PNG}
        openPanel={openPanel}
        icon={<ImageIcon size={20} aria-hidden="true" />}
        title="달력 이미지 저장"
        description="카톡으로 보내거나 사진첩에 보관"
        onToggle={handleToggle}
      >
        <PngExportPanel
          yearMonth={yearMonth}
          displayName={month.displayName}
          definitions={month.definitions}
          entries={month.entries}
        />
      </ExportRow>
      <div className="block">
        <h2>내 일정만 공유해요</h2>
        <p>
          동료들의 이름과 원본 근무표는
          <br />
          공유 화면에 표시되지 않아요.
        </p>
      </div>
    </>
  );
};

export default ExportSheet;
