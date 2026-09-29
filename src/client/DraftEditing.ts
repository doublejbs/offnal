import { MAX_DISPLAY_NAME_LENGTH, MAX_LABEL_LENGTH } from '@/domain/DomainLimits';
import { MAX_CODE_LENGTH, normalizeCode } from '@/domain/ScheduleValidator';
import { isValidTime } from '@/domain/ShiftTime';
import { type ShiftDefinition } from '@/domain/types/ShiftDefinition';
import { type ShiftEntry } from '@/domain/types/ShiftEntry';

export type DefinitionPatch = Partial<Omit<ShiftDefinition, 'code'>>;

export type AddDefinitionResult = {
  definitions: ShiftDefinition[];
  error: string | null;
};

/** Choosing a code confirms the date; choosing 미확인 (null) leaves it for review. */
export const applyCodeToDate = (entries: ShiftEntry[], date: string, code: string | null): ShiftEntry[] =>
  entries.map((entry) =>
    entry.date === date ? { date, code, reviewReasons: [], confirmed: code !== null } : entry,
  );

export const addDefinition = (
  definitions: ShiftDefinition[],
  rawCode: string,
  rawLabel: string,
): AddDefinitionResult => {
  const code = normalizeCode(rawCode);

  if (code.length === 0) {
    return { definitions, error: '코드를 입력해 주세요.' };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return { definitions, error: `코드는 ${MAX_CODE_LENGTH}자까지 입력할 수 있어요.` };
  }

  if (definitions.some((definition) => definition.code === code)) {
    return { definitions, error: '이미 있는 코드예요.' };
  }

  const label = rawLabel.trim().slice(0, MAX_LABEL_LENGTH) || code.slice(0, MAX_LABEL_LENGTH);
  const added: ShiftDefinition = {
    code,
    label,
    startTime: null,
    endTime: null,
    endsNextDay: null,
    isOff: false,
  };

  return { definitions: [...definitions, added], error: null };
};

const inferEndsNextDay = (definition: ShiftDefinition): boolean | null => {
  const { startTime, endTime } = definition;

  if (startTime === null || endTime === null || !isValidTime(startTime) || !isValidTime(endTime)) {
    return definition.endsNextDay;
  }

  return endTime <= startTime;
};

/**
 * Applies a patch. When a time changes and both times are set, the next-day flag follows the times
 * (a shift ending at or before its start ends the next day); the user can still see and change it.
 */
export const updateDefinition = (
  definitions: ShiftDefinition[],
  code: string,
  patch: DefinitionPatch,
): ShiftDefinition[] =>
  definitions.map((definition) => {
    if (definition.code !== code) {
      return definition;
    }

    const next: ShiftDefinition = { ...definition, ...patch };

    if (next.isOff) {
      return { ...next, startTime: null, endTime: null, endsNextDay: null };
    }

    if ('startTime' in patch || 'endTime' in patch) {
      return { ...next, endsNextDay: inferEndsNextDay(next) };
    }

    return next;
  });

export const isCodeUsed = (entries: ShiftEntry[], code: string): boolean =>
  entries.some((entry) => entry.code === code);

/** Returns the remaining definitions, or null when the code is still used by a date. */
export const removeDefinition = (
  definitions: ShiftDefinition[],
  entries: ShiftEntry[],
  code: string,
): ShiftDefinition[] | null => {
  if (isCodeUsed(entries, code)) {
    return null;
  }

  return definitions.filter((definition) => definition.code !== code);
};

/** Client-side guard so autosave never sends a body the server would reject. */
export const validateDraftInput = (displayName: string, definitions: ShiftDefinition[]): string | null => {
  const name = displayName.trim();

  if (name.length === 0) {
    return '이름을 입력해 주세요.';
  }

  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return `이름은 ${MAX_DISPLAY_NAME_LENGTH}자까지 입력할 수 있어요.`;
  }

  for (const definition of definitions) {
    const label = definition.label.trim();

    if (label.length === 0) {
      return `${definition.code} 코드의 이름을 입력해 주세요.`;
    }

    if (label.length > MAX_LABEL_LENGTH) {
      return `${definition.code} 코드의 이름은 ${MAX_LABEL_LENGTH}자까지 입력할 수 있어요.`;
    }
  }

  return null;
};
