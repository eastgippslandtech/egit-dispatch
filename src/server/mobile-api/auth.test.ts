import { describe, expect, it } from "vitest";

import {
  createMobileSessionTokens,
  exchangeMobileLogin,
  requireMobileAuth,
} from "./auth";

describe("mobile API auth", () => {
  it("rejects an authenticated Zoho email outside the allowlist", async () => {
    const result = await exchangeMobileLogin(
      {
        code: "zoho-auth-code",
        codeVerifier: "verifier",
        redirectUri: "egitcommand://auth/callback",
      },
      {
        exchangeZohoCode: async () => ({
          accessToken: "zoho-access",
          expiresIn: 3600,
        }),
        fetchZohoProfile: async () => ({ email: "outside@example.com" }),
        now: () => new Date("2026-07-12T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      email: "outside@example.com",
      status: "not-approved",
    });
  });

  it("does not treat the raw authorization code as a staff email", async () => {
    const result = await exchangeMobileLogin(
      {
        code: "code-riley@egit.com.au",
        codeVerifier: "verifier",
        redirectUri: "egitcommand://auth/callback",
      },
      {
        exchangeZohoCode: async () => ({
          accessToken: "zoho-access",
          expiresIn: 3600,
        }),
        fetchZohoProfile: async () => ({ email: "mattd@egit.com.au" }),
        now: () => new Date("2026-07-12T00:00:00.000Z"),
      },
    );

    expect(result.status).toBe("approved");
    expect(result.email).toBe("mattd@egit.com.au");
  });

  it("maps bearer access tokens to the signed-in mobile staff", () => {
    const session = createMobileSessionTokens({
      email: "mattd@egit.com.au",
      now: new Date("2026-07-12T00:00:00.000Z"),
      staffId: "staff-matt",
    });

    const auth = requireMobileAuth(
      new Request("https://command.egit.com.au/api/mobile/v1/me", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }),
      { now: () => new Date("2026-07-12T00:01:00.000Z") },
    );

    expect(auth).toEqual({
      email: "mattd@egit.com.au",
      staffId: "staff-matt",
    });
  });
});
