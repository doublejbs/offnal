/** Joins RFC 5545 folded lines back into logical lines. */
export const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');

/** VEVENT bodies (between BEGIN:VEVENT and END:VEVENT) of an ICS file, unfolded. */
export const getEvents = (ics: string): string[] =>
  unfold(ics)
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((block) => block.split('END:VEVENT')[0] ?? '');

/** Drops DTSTAMP lines (generation time) so two exports of the same month can be compared. */
export const withoutStamp = (ics: string): string => ics.replace(/^DTSTAMP:.*\r\n/gm, '');
