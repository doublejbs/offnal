'use client';

import { ChevronRight } from 'lucide-react';

import { describeRowReview, formatRowName } from '@/client/TeamDisplayText';
import { countRowReview } from '@/client/TeamRosterGrid';
import { type TeamRosterRowDto } from '@/domain/types/api/TeamRosterRowDto';

type RosterPersonListViewProps = {
  rows: TeamRosterRowDto[];
  onOpen: (rowId: string) => void;
};

/** Mobile review: one row per person with its review status; tapping opens the month editor for that row. */
const RosterPersonListView = ({ rows, onOpen }: RosterPersonListViewProps) => (
  <ul className="team-list" aria-label="사람별 확인">
    {rows.map((row) => {
      const reviewCount = countRowReview(row);
      const name = formatRowName(row);

      return (
        <li key={row.id}>
          <button
            type="button"
            className="team-item"
            data-row-button={row.id}
            data-excluded={row.excluded}
            data-review={reviewCount > 0}
            onClick={() => onOpen(row.id)}
          >
            <span className="team-item-body">
              <strong>{name}</strong>
              <small>
                {describeRowReview(row, reviewCount)}
                {row.linkedMember ? ` · ${row.linkedMember.displayName} 연결` : ''}
              </small>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="flex-none" />
          </button>
        </li>
      );
    })}
  </ul>
);

export default RosterPersonListView;
