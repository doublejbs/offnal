import { RecognitionErrorCode } from '@/domain/enums/RecognitionErrorCode';

/**
 * String values allowed in properties: members of these fixed enums only (Spec §23.1). TypeScript string
 * enums are nominal, so a plain string (a name, a code, a token) does not type-check as one of these.
 */
export type AnalyticsEnumValue = RecognitionErrorCode;

export type AnalyticsPropertyValue = number | boolean | AnalyticsEnumValue;

/** Only numbers, booleans and declared enum values: never names, schedules, tokens or source data. */
export type AnalyticsProperties = Readonly<Record<string, AnalyticsPropertyValue>>;

const ALLOWED_ENUM_VALUES: ReadonlySet<string> = new Set<string>([...Object.values(RecognitionErrorCode)]);

const MAX_PROPERTY_COUNT = 16;
/** camelCase identifiers, so a key can never carry free text either. */
const PROPERTY_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;

/** Rejected property bag. The message names the rule only, never the offending value. */
export class AnalyticsPropertyError extends Error {
  constructor(reason: string) {
    super(`Invalid analytics properties: ${reason}`);
    this.name = 'AnalyticsPropertyError';
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
};

const isAllowedValue = (value: unknown): value is AnalyticsPropertyValue => {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'boolean') {
    return true;
  }

  return typeof value === 'string' && ALLOWED_ENUM_VALUES.has(value);
};

/** Runtime check behind the type (callers may pass anything through casts or untyped data). Throws. */
export const validateAnalyticsProperties = (value: unknown): AnalyticsProperties => {
  if (!isPlainObject(value)) {
    throw new AnalyticsPropertyError('not a plain object');
  }

  const entries = Object.entries(value);

  if (entries.length > MAX_PROPERTY_COUNT) {
    throw new AnalyticsPropertyError('too many properties');
  }

  for (const [key, item] of entries) {
    if (!PROPERTY_KEY_PATTERN.test(key)) {
      throw new AnalyticsPropertyError('invalid key');
    }

    if (!isAllowedValue(item)) {
      throw new AnalyticsPropertyError('value must be a finite number, a boolean or a declared enum value');
    }
  }

  return Object.fromEntries(entries) as AnalyticsProperties;
};
