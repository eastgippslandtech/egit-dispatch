import { describe, expect, it } from "vitest";

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
});
