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

// Crockford base32 decoding table (case-insensitive, handles I→1, L→1, O→0)
const DECODE: Record<string, number> = {};
for (let i = 0; i < ENCODING.length; i++) {
  DECODE[ENCODING[i]] = i;
  DECODE[ENCODING[i].toLowerCase()] = i;
}
// Crockford spec: I/i→1, L/l→1, O/o→0
DECODE["I"] = 1;
DECODE["i"] = 1;
DECODE["L"] = 1;
DECODE["l"] = 1;
DECODE["O"] = 0;
DECODE["o"] = 0;

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

function incrementRandom(random: number[]): number[] {
  const next = [...random];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < ENCODING_LEN - 1) {
      next[i]++;
      return next;
    }
    next[i] = 0;
  }
  // Overflow — all 80 bits were maxed. Astronomically unlikely.
  throw new Error("ULID random overflow: cannot increment within same millisecond");
}

function randomCharsToString(chars: number[]): string {
  return chars.map((c) => ENCODING[c]).join("");
}

/**
 * Generate a ULID string. Monotonic within the same millisecond.
 */
export function generateUlid(): string {
  const now = Date.now();

  if (now === lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = encodeRandom(16);
  }

  return encodeTime(now, 10) + randomCharsToString(lastRandom);
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
