export type ShiftDefinition = {
  code: string;
  label: string;
  /** HH:mm in the calendar timezone */
  startTime: string | null;
  /** HH:mm in the calendar timezone */
  endTime: string | null;
  endsNextDay: boolean | null;
  isOff: boolean;
};
