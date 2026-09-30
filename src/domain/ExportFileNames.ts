/** Download file names of every export, shared by the API routes and the client. */
export const buildIcsFileName = (yearMonth: string): string => `offnal-${yearMonth}.ics`;

export const buildSharedIcsFileName = (yearMonth: string): string => `offnal-shared-${yearMonth}.ics`;

export const buildPngFileName = (yearMonth: string): string => `offnal-${yearMonth}.png`;

export const buildSharedPngFileName = (yearMonth: string): string => `offnal-shared-${yearMonth}.png`;
