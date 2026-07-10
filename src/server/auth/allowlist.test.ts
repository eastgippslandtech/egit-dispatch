import { describe, expect, it } from "vitest";

import { getAllowedAuthEmails, isAllowedAuthEmail } from "./allowlist";

describe("Command Centre auth allowlist", () => {
  it("denies access when the allowlist is empty", () => {
    expect(isAllowedAuthEmail("simeon@egit.com.au", "")).toBe(false);
    expect(isAllowedAuthEmail("simeon@egit.com.au", undefined)).toBe(false);
  });

  it("allows approved EGIT staff emails case-insensitively", () => {
    const allowlist =
      "simeon@egit.com.au,mattd@egit.com.au,jervy@egit.com.au,riley@egit.com.au";

    expect(isAllowedAuthEmail("Simeon@EGIT.com.au", allowlist)).toBe(true);
    expect(isAllowedAuthEmail(" mattd@egit.com.au ", allowlist)).toBe(true);
    expect(isAllowedAuthEmail("jervy@egit.com.au", allowlist)).toBe(true);
    expect(isAllowedAuthEmail("riley@egit.com.au", allowlist)).toBe(true);
  });

  it("blocks valid Zoho users who are not approved for Command Centre", () => {
    const allowlist = "simeon@egit.com.au,mattd@egit.com.au";

    expect(isAllowedAuthEmail("external@example.com", allowlist)).toBe(false);
    expect(isAllowedAuthEmail("matt@egit.com.au", allowlist)).toBe(false);
  });

  it("parses comma-separated emails without blank entries", () => {
    expect(getAllowedAuthEmails(" simeon@egit.com.au, ,MATTD@EGIT.COM.AU ")).toEqual([
      "simeon@egit.com.au",
      "mattd@egit.com.au",
    ]);
  });
});
