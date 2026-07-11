import { describe, expect, it } from "vitest";

import { exchangeMobileLogin } from "./auth";

describe("mobile API auth", () => {
  it("rejects an authenticated Zoho email outside the allowlist", async () => {
    const result = await exchangeMobileLogin({
      code: "code-outside@example.com",
      codeVerifier: "verifier",
      redirectUri: "egitcommand://auth/callback",
    });

    expect(result).toEqual({
      email: "outside@example.com",
      status: "not-approved",
    });
  });
});
