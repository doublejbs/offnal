import { Check, LoaderCircle } from 'lucide-react';

import { RecognitionStatus } from '@/domain/enums/RecognitionStatus';

type RecognitionProgressProps = {
  status: RecognitionStatus | null;
  isDelayed: boolean;
};

/** Real stages only: no percentages, no estimated time. */
const RecognitionProgress = ({ status, isDelayed }: RecognitionProgressProps) => {
  const isReading = status === RecognitionStatus.PROCESSING;

  return (
    <section aria-labelledby="progress-title">
      <div className="label">근무표 인식 중</div>
      <h1 id="progress-title">
        근무표를
        <br />
        읽고 있어요.
      </h1>
      <p>표 구조와 이름, 날짜, 근무 코드를 확인하고 있어요. 이 화면을 닫지 말아 주세요.</p>
      <ol className="steps" aria-live="polite">
        <li data-state="done">
          <Check size={18} aria-hidden="true" />
          사진 업로드 완료
        </li>
        <li data-state="active">
          <LoaderCircle size={18} aria-hidden="true" className="spin" />
          {isReading ? '표 읽는 중' : '표 읽기를 준비하는 중'}
        </li>
      </ol>
      {isDelayed && (
        <div className="notice" role="status">
          평소보다 오래 걸리고 있어요. 표가 크거나 복잡하면 시간이 더 걸릴 수 있어요. 조금만 더 기다려 주세요.
        </div>
      )}
    </section>
  );
};

export default RecognitionProgress;
