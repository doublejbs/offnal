/**
 * Page view URLs sent to Vercel Web Analytics (Spec §23.4): token and id segments become patterns and only
 * `utm_*` query parameters survive. Pure, so the same rules are unit tested and used by `beforeSend`.
 */

const TOKEN_PLACEHOLDER = '[token]';
const ID_PLACEHOLDER = '[id]';
const YEAR_MONTH_PLACEHOLDER = '[yearMonth]';
const UTM_PREFIX = 'utm_';

/** First segment → placeholder for the segment right after it. */
const SECOND_SEGMENT_PLACEHOLDERS: Record<string, string> = {
  s: TOKEN_PLACEHOLDER,
  join: TOKEN_PLACEHOLDER,
  recognitions: ID_PLACEHOLDER,
  drafts: ID_PLACEHOLDER,
  teams: ID_PLACEHOLDER,
  checkout: YEAR_MONTH_PLACEHOLDER,
};

/** Segments under `/teams/[id]/...` that are followed by an id or a month. */
const TEAM_CHILD_PLACEHOLDERS: Record<string, string> = {
  rosters: ID_PLACEHOLDER,
  roster: YEAR_MONTH_PLACEHOLDER,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Long opaque base64url/hex values (share and invite tokens are 43 chars). */
const TOKEN_LIKE_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

const looksLikeIdentifier = (segment: string): boolean =>
  UUID_PATTERN.test(segment) || TOKEN_LIKE_PATTERN.test(segment);

const redactSegment = (segments: string[], index: number): string => {
  const segment = segments[index] ?? '';
  const first = segments[0] ?? '';

  if (index === 1 && SECOND_SEGMENT_PLACEHOLDERS[first]) {
    return SECOND_SEGMENT_PLACEHOLDERS[first];
  }

  const previous = segments[index - 1] ?? '';

  if (first === 'teams' && index === 3 && TEAM_CHILD_PLACEHOLDERS[previous]) {
    return TEAM_CHILD_PLACEHOLDERS[previous];
  }

  return looksLikeIdentifier(segment) ? ID_PLACEHOLDER : segment;
};

/** `/drafts/6f1c…` → `/drafts/[id]`. */
export const redactPagePath = (pathname: string): string => {
  const segments = pathname.split('/').slice(1);

  return `/${segments.map((_, index) => redactSegment(segments, index)).join('/')}`;
};

/** Absolute URL with a redacted path, `utm_*` parameters only and no fragment; null when unparsable. */
export const redactPageUrl = (url: string): string | null => {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const kept = new URLSearchParams();

  for (const [key, value] of parsed.searchParams) {
    if (key.startsWith(UTM_PREFIX)) {
      kept.append(key, value);
    }
  }

  const query = kept.toString();

  return `${parsed.origin}${redactPagePath(parsed.pathname)}${query ? `?${query}` : ''}`;
};

/** `beforeSend` for `<Analytics />`: the event with a redacted URL, or null (dropped) when unparsable. */
export const redactPageView = <TEvent extends { url: string }>(event: TEvent): TEvent | null => {
  const url = redactPageUrl(event.url);

  if (url === null) {
    return null;
  }

  return { ...event, url };
};
