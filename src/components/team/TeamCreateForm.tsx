'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';

import { getErrorMessage } from '@/client/ApiClient';
import { createTeam } from '@/client/TeamApiClient';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/DomainLimits';

type TeamCreateFormProps = {
  isFirstTeam: boolean;
};

/** "팀 만들기": the creator becomes the team's first admin and lands on the admin screen. */
const TeamCreateForm = ({ isFirstTeam }: TeamCreateFormProps) => {
  const router = useRouter();
  const [name, setName] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const errorId = useId();
  const trimmed = name.trim();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (trimmed.length === 0 || isBusy) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const created = await createTeam({ name: trimmed });

      router.push(`/teams/${created.team.id}`);
    } catch (caught: unknown) {
      setError(getErrorMessage(caught));
      setIsBusy(false);
    }
  };

  return (
    <section aria-labelledby={titleId} className="mt-20">
      <h2 id={titleId}>{isFirstTeam ? '팀 만들기' : '새 팀 만들기'}</h2>
      <form onSubmit={handleSubmit} className="stack">
        <label className="field m-0">
          팀 이름
          <input
            value={name}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            placeholder="예: 7병동 간호팀"
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="tiny">만든 사람이 관리자가 돼요. 이름은 나중에 바꿀 수 있어요.</div>
        {error && (
          <div id={errorId} className="warning" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="primary" disabled={trimmed.length === 0 || isBusy}>
          {isBusy ? '만드는 중…' : '팀 만들기'}
        </button>
      </form>
    </section>
  );
};

export default TeamCreateForm;
