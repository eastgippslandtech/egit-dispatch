import { beforeEach, describe, expect, it, vi } from "vitest";

const webBrowser = vi.hoisted(() => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));

const authSession = vi.hoisted(() => {
  const request = {
    codeVerifier: "pkce-verifier",
    makeAuthUrlAsync: vi.fn(async () =>
      "https://accounts.zoho.com.au/oauth/v2/auth?redirect_uri=https%3A%2F%2Fcommand.egit.com.au%2Fapi%2Fmobile%2Fv1%2Fauth%2Fcallback",
    ),
    parseReturnUrl: vi.fn(() => ({
      params: {
        "accounts-server": "https://accounts.zoho.com.au",
        code: "auth-code-1",
      },
      type: "success",
    })),
  };

  return {
    AuthRequest: vi.fn(function AuthRequest() {
      return request;
    }),
    CodeChallengeMethod: { S256: "S256" },
    ResponseType: { Code: "code" },
    request,
  };
});

vi.mock("expo-web-browser", () => webBrowser);
vi.mock("expo-auth-session", () => authSession);
vi.mock("./session-store", () => ({
  saveMobileSession: vi.fn(),
}));

describe("Zoho native sign-in bootstrap", () => {
  beforeEach(() => {
    webBrowser.maybeCompleteAuthSession.mockClear();
    webBrowser.openAuthSessionAsync.mockReset();
    authSession.AuthRequest.mockClear();
    authSession.request.makeAuthUrlAsync.mockClear();
    authSession.request.parseReturnUrl.mockClear();
  });

  it("registers browser auth-session completion handling", async () => {
    await import("./zoho-sign-in");

    expect(webBrowser.maybeCompleteAuthSession).toHaveBeenCalledTimes(1);
  });

  it("opens Zoho with the web callback while waiting for the native callback", async () => {
    webBrowser.openAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: "egitcommand://auth/callback?state=state-1&code=auth-code-1",
    });
    const { performZohoSignIn } = await import("./zoho-sign-in");

    await performZohoSignIn({
      fetcher: async () =>
        Response.json({
          data: {
            email: "mattd@egit.com.au",
            session: {
              accessToken: "access-token",
              expiresAt: "2030-01-01T00:00:00.000Z",
              refreshToken: "refresh-token",
            },
            staff: {
              accent: "orange",
              displayName: "Matt",
              email: "mattd@egit.com.au",
              id: "staff-matt",
              initials: "MD",
              role: "Technician",
              zohoEmail: "mattd@egit.com.au",
            },
            staffId: "staff-matt",
            status: "approved",
          },
        }),
    });

    expect(authSession.AuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri:
          "https://command.egit.com.au/api/mobile/v1/auth/callback",
      }),
    );
    expect(webBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      expect.stringContaining(
        "redirect_uri=https%3A%2F%2Fcommand.egit.com.au%2Fapi%2Fmobile%2Fv1%2Fauth%2Fcallback",
      ),
      "egitcommand://auth/callback",
      { preferEphemeralSession: true },
    );
  });
});
