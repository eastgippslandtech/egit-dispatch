import { describe, expect, it, vi } from "vitest";

import {
  buildMspCentralAuthorizationUrl,
  exchangeMspCentralAuthorizationCode,
} from "./oauth";

describe("MSP Central OAuth reauthorisation", () => {
  it("requests the Helpdesk scopes needed by Command Centre", () => {
    const url = new URL(
      buildMspCentralAuthorizationUrl({
        accountsUrl: "https://accounts.zoho.com.au",
        clientId: "client-id",
        redirectUri:
          "https://command.egit.com.au/api/internal/msp-central/oauth/callback",
        state: "opaque-state",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.zoho.com.au/oauth/v2/auth",
    );
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "SDPOnDemand.requests.ALL",
      "SDPOnDemand.setup.READ",
      "SDPOnDemand.general.READ",
    ]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("opaque-state");
  });

  it("exchanges the one-time code for a stored service credential", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        access_token: "short-lived-access-token",
        api_domain: "https://servicedeskplus.net.au",
        expires_in: 3600,
        refresh_token: "durable-refresh-token",
      }),
    );

    const credential = await exchangeMspCentralAuthorizationCode({
      accountsUrl: "https://accounts.zoho.com.au",
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "one-time-code",
      fetchImpl: fetchImpl as typeof fetch,
      redirectUri:
        "https://command.egit.com.au/api/internal/msp-central/oauth/callback",
    });

    expect(credential).toEqual({
      accessToken: "short-lived-access-token",
      apiDomain: "https://servicedeskplus.net.au",
      expiresInSeconds: 3600,
      refreshToken: "durable-refresh-token",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://accounts.zoho.com.au/oauth/v2/token",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toContain("grant_type=authorization_code");
    expect(String(request.body)).toContain("code=one-time-code");
  });
});
