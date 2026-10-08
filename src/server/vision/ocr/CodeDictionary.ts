/** Shift-code dictionary and OCR whitelists of the AI-free reader (Spec §21). */

export type CodeWhitelist = {
  /** Upper-case Latin letters of the known codes (sorted, unique). */
  latin: string;
  /** Hangul syllables of the known codes (sorted, unique). */
  hangul: string;
};

/** One OCR reading of a cell, before dictionary matching. */
export type TokenReading = { token: string; confidence: number };

export type CodeMatch = {
  /** Dictionary code, or null when unresolved (low confidence, out of dictionary, empty). */
  code: string | null;
  token: string;
};

/** The literal off code; Spec §16 lets it be defined as off even outside the legend. */
export const OFF_CODE = 'OFF';
/** Codes are short (D, OFF, 연차); longer readings are noise (two cells, a note). */
export const MAX_TOKEN_LENGTH = 4;

const LATIN_PATTERN = /^[A-Z]+$/u;
const HANGUL_PATTERN = /^[가-힣]+$/u;
const LATIN_CHAR = /[A-Z]/u;
const HANGUL_CHAR = /[가-힣]/u;

/** NFC, upper case, only Latin letters and Hangul syllables kept (OCR adds spaces, bars and quotes). */
export const normalizeToken = (text: string): string =>
  text
    .normalize('NFC')
    .toUpperCase()
    .replace(/[^A-Z가-힣]/gu, '');

export const isLatinToken = (token: string): boolean => LATIN_PATTERN.test(token);

export const isHangulToken = (token: string): boolean => HANGUL_PATTERN.test(token);

/** Valid code shape: 1–4 letters of a single script. */
export const isCodeShaped = (token: string): boolean =>
  token.length > 0 && token.length <= MAX_TOKEN_LENGTH && (isLatinToken(token) || isHangulToken(token));

/** Whitelists from the dictionary's characters, split by script (each OCR pass uses one script). */
export const buildCodeWhitelist = (codes: Iterable<string>): CodeWhitelist => {
  const latin = new Set<string>();
  const hangul = new Set<string>();

  for (const code of codes) {
    for (const char of normalizeToken(code)) {
      if (LATIN_CHAR.test(char)) {
        latin.add(char);
      } else if (HANGUL_CHAR.test(char)) {
        hangul.add(char);
      }
    }
  }

  return { latin: [...latin].sort().join(''), hangul: [...hangul].sort().join('') };
};

/**
 * Tokens read confidently in at least `minCount` cells of the table: codes outside the legend (W, M, 연차)
 * become known this way. One-off readings stay out (a single misread must not become a code).
 */
export const selectFrequentTokens = (
  readings: TokenReading[],
  minCount: number,
  minConfidence: number,
): string[] => {
  const counts = new Map<string, number>();

  for (const reading of readings) {
    if (reading.confidence >= minConfidence && isCodeShaped(reading.token)) {
      counts.set(reading.token, (counts.get(reading.token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([token]) => token)
    .sort();
};

/**
 * Exact dictionary lookup with a confidence floor. Anything else — low confidence, a token outside the
 * dictionary, an empty reading — is unresolved (null): never guessed to the nearest code.
 */
export const matchCode = (
  reading: TokenReading,
  dictionary: ReadonlySet<string>,
  minConfidence: number,
): CodeMatch => {
  const token = normalizeToken(reading.token);

  if (token.length === 0 || reading.confidence < minConfidence || !dictionary.has(token)) {
    return { code: null, token };
  }

  return { code: token, token };
};
