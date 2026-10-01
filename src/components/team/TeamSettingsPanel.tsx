'use client';

import { type FormEvent, useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { updateTeam } from '@/client/TeamApiClient';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';
import { type TeamDetailResponse } from '@/domain/types/api/TeamDetailResponse';
import { type UpdateTeamRequest } from '@/domain/types/api/UpdateTeamRequest';

type TeamSettingsPanelProps = {
  detail: TeamDetailResponse;
  onSaved: (detail: TeamDetailResponse) => void;
};

/** Team name and "팀원끼리 전체 근무표 보기" (default on). Each change is one PATCH. */
const TeamSettingsPanel = ({ detail, onSaved }: TeamSettingsPanelProps) => {
  const [name, setName] = useState(detail.team.name);
  const [isBusy, setIsBusy] = useState(false);
  // Optimistic toggle: shown at once, rolled back when the PATCH fails.
  const [shareOverride, setShareOverride] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const save = async (body: UpdateTeamRequest, successMessage: string) => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      onSaved(await updateTeam(detail.team.id, body));
      setMessage(successMessage);
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
    } finally {
      setShareOverride(null);
      setIsBusy(false);
    }
  };

  const handleSubmitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (trimmed.length > 0 && trimmed !== detail.team.name) {
      void save({ name: trimmed }, '팀 이름을 바꿨어요.');
    }
  };

  const handleToggleShare = (isOn: boolean) => {
    setShareOverride(isOn);
    void save(
      { shareRosterWithMembers: isOn },
      isOn ? '팀원도 전체 근무표를 볼 수 있어요.' : '이제 팀원은 자기 근무만 볼 수 있어요.',
    );
  };

  return (
    <div>
      <form onSubmit={handleSubmitName} className="stack">
        <label className="field m-0">
          팀 이름
          <input
            value={name}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            disabled={isBusy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="secondary"
          disabled={isBusy || trimmed.length === 0 || trimmed === detail.team.name}
        >
          이름 저장
        </button>
      </form>
      <label className="check mt-20">
        <input
          type="checkbox"
          checked={shareOverride ?? detail.team.shareRosterWithMembers}
          disabled={isBusy}
          onChange={(event) => handleToggleShare(event.target.checked)}
        />
        <span>
          <strong>팀원끼리 전체 근무표 보기</strong>
          <span className="tiny block-text">
            켜 두면 승인된 팀원이 배포된 근무표 전체(이름·날짜·근무 코드)를 볼 수 있어요. 병동에 붙여 두는
            근무표와 같은 범위예요. 끄면 팀원은 자기 근무만 보고, 관리자는 계속 전체를 봐요.
          </span>
        </span>
      </label>
      {error && (
        <div className="warning" role="alert">
          {error}
        </div>
      )}
      <div className="status-line" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
};

export default TeamSettingsPanel;
