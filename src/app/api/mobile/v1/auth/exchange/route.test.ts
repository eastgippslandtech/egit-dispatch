import { beforeEach, describe, expect, it, vi } from "vitest";

import { exchangeMobileLogin } from "@/server/mobile-api/auth";

import { POST } from "./route";

vi.mock("@/server/mobile-api/auth", () => ({
  exchangeMobileLogin: vi.fn(),
}));

const mockedExchangeMobileLogin = vi.mocked(exchangeMobileLogin);

describe("mobile auth exchange route", () => {
  beforeEach(() => {
    mockedExchangeMobileLogin.mockReset();
  });

  it("returns a mobile JSON error when Zoho rejects the authorization code", async () => {
    mockedExchangeMobileLogin.mockRejectedValue(
      Object.assign(new Error("Zoho authorization code exchange failed."), {
        code: "UNAUTHORIZED",
        status: 401,
      }),
    );

    const response = await POST(
      new Request("https://command.egit.com.au/api/mobile/v1/auth/exchange", {
        body: JSON.stringify({
          code: "expired-code",
          codeVerifier: "pkce-verifier",
          redirectUri: "egitcommandcentre://auth/zoho",
        }),
        method: "POST",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        message: "Zoho authorization code exchange failed.",
      },
    });
    expect(response.status).toBe(401);
  });
});
