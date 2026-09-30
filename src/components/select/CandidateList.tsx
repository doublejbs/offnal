import { type RecognitionCandidate } from '@/domain/types/RecognitionCandidate';

type CandidateListProps = {
  candidates: RecognitionCandidate[];
  selectedRowId: string | null;
  disabled: boolean;
  onSelect: (rowId: string) => void;
};

/** Recognized names as radio rows (long names wrap). */
const CandidateList = ({ candidates, selectedRowId, disabled, onSelect }: CandidateListProps) => (
  <fieldset className="plain-fieldset" disabled={disabled}>
    <legend className="tiny mb-12">인식된 이름</legend>
    {candidates.length === 0 && (
      <div className="warning">인식된 이름이 없어요. 이름을 직접 입력해 주세요.</div>
    )}
    {candidates.map((candidate) => (
      <label key={candidate.rowId} className="person">
        <span>{candidate.name}</span>
        <input
          type="radio"
          name="person"
          value={candidate.rowId}
          checked={selectedRowId === candidate.rowId}
          onChange={() => onSelect(candidate.rowId)}
        />
      </label>
    ))}
  </fieldset>
);

export default CandidateList;
