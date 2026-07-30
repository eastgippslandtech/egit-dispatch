import { describe, expect, it } from "vitest";

import { normalizeAustralianPhone } from "./phone";

describe("normalizeAustralianPhone", () => {
  it.each([
    ["0412 345 678", "+61412345678"],
    ["(03) 5150 1000", "+61351501000"],
    ["61 412 345 678", "+61412345678"],
    ["+61 3 5150 1000", "+61351501000"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeAustralianPhone(input)).toBe(expected);
  });

  it.each(["", "private", "000", "12345", "+999999"])(
    "rejects ambiguous number %s",
    (input) => {
      expect(normalizeAustralianPhone(input)).toBeUndefined();
    },
  );
});
