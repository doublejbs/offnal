'use client';

import { formatJoinableRow } from '@/client/TeamDisplayText';
import { type JoinableRowDto } from '@/domain/types/api/JoinableRowDto';

/** `<select>` value for "no row". Row keys never start with "#". */
export const NO_ROW_VALUE = '#none';

type RowPickerProps = {
  label: string;
  rows: JoinableRowDto[];
  value: string | null;
  noRowLabel: string;
  disabled?: boolean;
  onChange: (rowKey: string | null) => void;
};

/** Roster row picker showing name · ordinal (same names) · first 3 codes (TeamShareSpec §3.2-4). */
const RowPicker = ({ label, rows, value, noRowLabel, disabled, onChange }: RowPickerProps) => (
  <label className="inline-field">
    {label}
    <select
      value={value ?? NO_ROW_VALUE}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === NO_ROW_VALUE ? null : event.target.value)}
    >
      {rows.map((row) => (
        <option key={row.rowKey} value={row.rowKey}>
          {formatJoinableRow(row)}
        </option>
      ))}
      <option value={NO_ROW_VALUE}>{noRowLabel}</option>
    </select>
  </label>
);

export default RowPicker;
