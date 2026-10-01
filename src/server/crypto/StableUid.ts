import 'server-only';

import { hashSha256Hex } from '@/server/crypto/TokenCrypto';

const UID_HASH_LENGTH = 16;

/**
 * Stable but not reversible ICS UID base (sha256 prefix): the same input always gives the same events, and
 * files people forward never carry internal IDs.
 */
export const buildStableUidBase = (value: string): string => hashSha256Hex(value).slice(0, UID_HASH_LENGTH);
