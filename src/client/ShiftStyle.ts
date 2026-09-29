import { ShiftTone } from '@/domain/enums/ShiftTone';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

const STANDARD_TONES: Record<string, ShiftTone> = {
  D: ShiftTone.DAY,
  E: ShiftTone.EVENING,
  N: ShiftTone.NIGHT,
  S: ShiftTone.MIDDLE,
  OFF: ShiftTone.OFF,
};

export const getShiftTone = (code: string | null, definitions: ShiftDefinition[]): ShiftTone => {
  if (code === null) {
    return ShiftTone.UNKNOWN;
  }

  const standard = STANDARD_TONES[code];

  if (standard) {
    return standard;
  }

  const definition = definitions.find((item) => item.code === code);

  return definition?.isOff ? ShiftTone.OFF : ShiftTone.CUSTOM;
};

export const isEntryUnconfirmed = (entry: ShiftEntry): boolean => entry.code === null || !entry.confirmed;

/** Tone for a calendar cell: unconfirmed entries always use the orange review tone. */
export const getEntryTone = (entry: ShiftEntry, definitions: ShiftDefinition[]): ShiftTone =>
  isEntryUnconfirmed(entry) ? ShiftTone.UNKNOWN : getShiftTone(entry.code, definitions);

export const getBadgeText = (entry: ShiftEntry): string => {
  if (entry.code === null) {
    return '확인';
  }

  return entry.confirmed ? entry.code : `${entry.code}?`;
};

/** Accessible status text ("E 확인 필요"). */
export const describeEntryStatus = (entry: ShiftEntry): string => {
  const code = entry.code ?? '근무 미확인';

  return isEntryUnconfirmed(entry) ? `${code} 확인 필요` : code;
};

export const toneClassName = (tone: ShiftTone): string => `badge tone-${tone}`;
