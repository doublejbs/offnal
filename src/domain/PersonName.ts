/** Names compare after NFC and whitespace removal (models sometimes space out Korean names). */
export const normalizePersonName = (name: string): string => name.normalize('NFC').replace(/\s+/gu, '');
