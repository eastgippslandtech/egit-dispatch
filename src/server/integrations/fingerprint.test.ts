import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { fingerprintPayload } from "./fingerprint";

describe("fingerprintPayload", () => {
  it("ignores object key ordering", () => {
    expect(fingerprintPayload({ b: 2, a: 1 })).toBe(
      fingerprintPayload({ a: 1, b: 2 }),
    );
  });

  it("distinguishes semantically different payloads", () => {
    expect(fingerprintPayload({ a: 1 })).not.toBe(
      fingerprintPayload({ a: 2 }),
    );
  });

  it("preserves array ordering", () => {
    expect(fingerprintPayload({ values: [1, 2] })).not.toBe(
      fingerprintPayload({ values: [2, 1] }),
    );
  });

  it("sorts keys by Unicode codepoint rather than locale", () => {
    const canonicalJson = '{"z":1,"ä":2}';
    const expected = createHash("sha256").update(canonicalJson).digest("hex");

    expect(fingerprintPayload({ ä: 2, z: 1 })).toBe(expected);
  });

  it("sorts astral keys by Unicode codepoint rather than UTF-16 code unit", () => {
    const canonicalJson = '{"":1,"𐀀":2}';
    const expected = createHash("sha256").update(canonicalJson).digest("hex");

    expect(fingerprintPayload({ "𐀀": 2, "": 1 })).toBe(expected);
  });

  it("accepts Date values through their standard JSON representation", () => {
    expect(fingerprintPayload({ at: new Date("2026-08-03T10:00:00.000Z") })).toBe(
      fingerprintPayload({ at: "2026-08-03T10:00:00.000Z" }),
    );
  });

  it("rejects values that are not JSON-compatible", () => {
    expect(() => fingerprintPayload({ missing: undefined })).toThrow(
      "JSON-compatible",
    );
  });
});
