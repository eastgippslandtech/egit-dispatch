import { describe, expect, it } from "vitest";

import { normalizeRequestNickname } from "./request-nickname";

describe("request nickname", () => {
  it("trims and collapses whitespace without changing the user's words", () => {
    expect(normalizeRequestNickname("  Front   counter\nprinter  ")).toBe("Front counter printer");
  });

  it("uses null to clear a nickname", () => {
    expect(normalizeRequestNickname("  ")).toBeNull();
    expect(normalizeRequestNickname(null)).toBeNull();
  });

  it("rejects long or non-string nicknames", () => {
    expect(() => normalizeRequestNickname("a".repeat(81))).toThrow(/80/);
    expect(() => normalizeRequestNickname(42)).toThrow(/string/);
  });
});
