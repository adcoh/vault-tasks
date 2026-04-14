import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateUlid,
  isValidUlid,
  decodeTime,
  _resetMonotonicState,
} from "../ulid.js";

describe("generateUlid", () => {
  beforeEach(() => {
    _resetMonotonicState();
  });

  it("returns a 26-character string", () => {
    const ulid = generateUlid();
    assert.equal(ulid.length, 26);
  });

  it("contains only valid Crockford base32 characters", () => {
    const ulid = generateUlid();
    assert.match(ulid, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("does not contain excluded characters I, L, O, U", () => {
    // Generate many ULIDs to increase coverage of alphabet
    for (let i = 0; i < 100; i++) {
      const ulid = generateUlid();
      assert.ok(!ulid.includes("I"), `ULID contains I: ${ulid}`);
      assert.ok(!ulid.includes("L"), `ULID contains L: ${ulid}`);
      assert.ok(!ulid.includes("O"), `ULID contains O: ${ulid}`);
      assert.ok(!ulid.includes("U"), `ULID contains U: ${ulid}`);
    }
  });

  it("generates monotonically increasing values", () => {
    const ulids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ulids.push(generateUlid());
    }
    for (let i = 1; i < ulids.length; i++) {
      assert.ok(
        ulids[i] > ulids[i - 1],
        `ULID ${i} (${ulids[i]}) should be > ULID ${i - 1} (${ulids[i - 1]})`
      );
    }
  });

  it("produces unique values across rapid calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(generateUlid());
    }
    assert.equal(set.size, 1000, "All 1000 ULIDs should be unique");
  });

  it("encodes a valid timestamp in the first 10 characters", () => {
    const before = Date.now();
    const ulid = generateUlid();
    const after = Date.now();
    const decoded = decodeTime(ulid);
    assert.ok(decoded >= before, `Decoded time ${decoded} should be >= ${before}`);
    assert.ok(decoded <= after, `Decoded time ${decoded} should be <= ${after}`);
  });
});

describe("isValidUlid", () => {
  it("accepts a valid ULID", () => {
    const ulid = generateUlid();
    assert.ok(isValidUlid(ulid));
  });

  it("accepts lowercase input", () => {
    const ulid = generateUlid();
    assert.ok(isValidUlid(ulid.toLowerCase()));
  });

  it("rejects strings that are too short", () => {
    assert.ok(!isValidUlid("01ARZ3NDEKTSV4RR"));
  });

  it("rejects strings that are too long", () => {
    assert.ok(!isValidUlid("01ARZ3NDEKTSV4RRGSSFQ9XNHY0X"));
  });

  it("rejects strings with excluded characters", () => {
    // I, L, O, U are excluded from Crockford base32
    assert.ok(!isValidUlid("01ARZ3NDIKTSV4RRGSSFQ9XNHY")); // I at position 7
    assert.ok(!isValidUlid("01ARZ3NDLKTSV4RRGSSFQ9XNHY")); // L at position 7
    assert.ok(!isValidUlid("01ARZ3NDOKTSV4RRGSSFQ9XNHY")); // O at position 7
    assert.ok(!isValidUlid("01ARZ3NDUKTSV4RRGSSFQ9XNHY")); // U at position 7
  });

  it("rejects empty string", () => {
    assert.ok(!isValidUlid(""));
  });

  it("rejects non-alphanumeric characters", () => {
    assert.ok(!isValidUlid("01ARZ3NDEKTSV4RR-SSFQ9XNHY"));
  });
});

describe("decodeTime", () => {
  it("round-trips a known timestamp", () => {
    const now = Date.now();
    const ulid = generateUlid();
    const decoded = decodeTime(ulid);
    // Should be within 1ms of now
    assert.ok(Math.abs(decoded - now) <= 1);
  });

  it("throws on invalid length", () => {
    assert.throws(() => decodeTime("short"), /expected 26 characters/);
  });

  it("throws on invalid characters", () => {
    assert.throws(
      () => decodeTime("!LARZ3NDEKTSV4RRGSSFQ9XNHY"),
      /Invalid ULID character/
    );
  });
});
