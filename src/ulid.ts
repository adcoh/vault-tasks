import { randomBytes } from "node:crypto";

/**
 * Zero-dependency ULID generator implementing the ULID spec.
 * https://github.com/ulid/spec
 *
 * Format: 26-character Crockford base32 string
 *   - 10 chars: millisecond timestamp (48 bits)
 *   - 16 chars: cryptographic randomness (80 bits)
 *
 * Monotonic: same-millisecond calls increment the random portion.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length; // 32

// Canonical Crockford base32 decoding table. We reject I, L, O (and U) as
// invalid rather than translating them: since this module is the sole producer
// of ULIDs in the vault, any ULID we encounter that contains those letters is
// either corrupted or hand-edited — treating it as "probably 0/1" silently
// papers over a real problem. Stay strict and fail loudly.
const DECODE: Record<string, number> = {};
for (let i = 0; i < ENCODING.length; i++) {
  DECODE[ENCODING[i]] = i;
  DECODE[ENCODING[i].toLowerCase()] = i;
}

// Monotonic state
let lastTime = 0;
let lastRandom: number[] = new Array(16).fill(0);

function encodeTime(now: number, len: number): string {
  let mod: number;
  let remaining = now;
  const chars: string[] = new Array(len);

  for (let i = len - 1; i >= 0; i--) {
    mod = remaining % ENCODING_LEN;
    chars[i] = ENCODING[mod];
    remaining = (remaining - mod) / ENCODING_LEN;
  }

  return chars.join("");
}

function encodeRandom(len: number): number[] {
  const bytes = randomBytes(len);
  const chars: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    // No modulo bias: 256 % 32 === 0, so all values 0-31 are equally likely
    chars[i] = bytes[i] % ENCODING_LEN;
  }
  return chars;
}

function incrementRandom(random: number[]): number[] | null {
  const next = [...random];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < ENCODING_LEN - 1) {
      next[i]++;
      return next;
    }
    next[i] = 0;
  }
  // All 80 random bits maxed — astronomically unlikely, but signal overflow
  // to the caller instead of throwing, so it can bump lastTime by 1 ms.
  return null;
}

function randomCharsToString(chars: number[]): string {
  return chars.map((c) => ENCODING[c]).join("");
}

/**
 * Generate a ULID string. Monotonic within the same millisecond.
 */
export function generateUlid(): string {
  const now = Date.now();
  // Guard against clock skew (NTP step backwards): never let lastTime regress.
  const effective = now > lastTime ? now : lastTime;

  if (effective === lastTime) {
    const incremented = incrementRandom(lastRandom);
    if (incremented === null) {
      // 80-bit space exhausted in a single ms — bump to the next ms and reseed.
      lastTime = effective + 1;
      lastRandom = encodeRandom(16);
    } else {
      lastRandom = incremented;
    }
  } else {
    lastTime = effective;
    lastRandom = encodeRandom(16);
  }

  return encodeTime(lastTime, 10) + randomCharsToString(lastRandom);
}

const VALID_ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Validate that a string is a well-formed ULID.
 * Checks length (26) and that all characters are in the Crockford base32 alphabet.
 */
export function isValidUlid(s: string): boolean {
  return VALID_ULID_RE.test(s.toUpperCase());
}

/**
 * Extract the millisecond timestamp from a ULID string.
 * Returns the Unix epoch milliseconds encoded in the first 10 characters.
 */
export function decodeTime(ulid: string): number {
  if (ulid.length !== 26) {
    throw new Error(`Invalid ULID: expected 26 characters, got ${ulid.length}`);
  }

  const timeChars = ulid.slice(0, 10).toUpperCase();
  let time = 0;

  for (const char of timeChars) {
    const val = DECODE[char];
    if (val === undefined) {
      throw new Error(`Invalid ULID character: ${char}`);
    }
    time = time * ENCODING_LEN + val;
  }

  return time;
}

/**
 * Reset monotonic state. Only for testing.
 */
export function _resetMonotonicState(): void {
  lastTime = 0;
  lastRandom = new Array(16).fill(0);
}
