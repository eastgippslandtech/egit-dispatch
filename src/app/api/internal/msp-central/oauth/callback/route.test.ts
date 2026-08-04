import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getConfiguredMspOAuthCredentialStore } from "@/server/msp-central/credential-store";
import { exchangeMspCentralAuthorizationCode } from "@/server/msp-central/oauth";

import { GET } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));
vi.mock("@/server/msp-central/credential-store", () => ({
  getConfiguredMspOAuthCredentialStore: vi.fn(),
}));
vi.mock("@/server/msp-central/oauth", () => ({
  exchangeMspCentralAuthorizationCode: vi.fn(),
}));

const accessMock = vi.mocked(getCommandCentreAccess);
const credentialStoreMock = vi.mocked(getConfiguredMspOAuthCredentialStore);
const exchangeMock = vi.mocked(exchangeMspCentralAuthorizationCode);

describe("MSP Central OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the replacement refresh credential and redirects safely", async () => {
    const saveCredential = vi.fn(async () => undefined);
    accessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    credentialStoreMock.mockReturnValueOnce({
      getCredential: vi.fn(),
      saveCredential,
    });
    exchangeMock.mockResolvedValueOnce({
      accessToken: "access-token",
      apiDomain: "https://servicedeskplus.net.au",
      expiresInSeconds: 3600,
      refreshToken: "replacement-refresh-token",
    });
    process.env.APP_BASE_URL = "https://command.egit.com.au";
    process.env.MSP_CENTRAL_ACCOUNTS_URL = "https://accounts.zoho.com.au";
    process.env.MSP_CENTRAL_CLIENT_ID = "client-id";
    process.env.MSP_CENTRAL_CLIENT_SECRET = "client-secret";
    const request = new Request(
      "https://command.egit.com.au/api/internal/msp-central/oauth/callback?code=one-time-code&state=matching-state",
      { headers: { cookie: "msp_oauth_state=matching-state" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://command.egit.com.au/integrations?msp=connected",
    );
    expect(saveCredential).toHaveBeenCalledWith({
      apiDomain: "https://servicedeskplus.net.au",
      refreshToken: "replacement-refresh-token",
      updatedBy: "simeon@egit.com.au",
    });
    expect(JSON.stringify(await response.text())).not.toContain(
      "replacement-refresh-token",
    );
  });

  it("rejects a callback whose state does not match the protected cookie", async () => {
    accessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    const request = new Request(
      "https://command.egit.com.au/api/internal/msp-central/oauth/callback?code=one-time-code&state=wrong-state",
      { headers: { cookie: "msp_oauth_state=expected-state" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});
