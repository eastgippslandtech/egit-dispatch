import { describe, expect, it } from "vitest";

import {
  MOBILE_AUTH_REDIRECT_URI,
  buildZohoAuthorizationRequest,
  mobileZohoCallbackUriFor,
} from "./auth-session";

describe("native auth session", () => {
  it("uses authorization code with PKCE S256 and no client secret", () => {
    const request = buildZohoAuthorizationRequest({
      clientId: "zoho-native-client",
      redirectUri: "egitcommand://auth/callback",
      scopes: ["AaaServer.profile.READ"],
      state: "state-1",
    });

    expect(request.responseType).toBe("code");
    expect(request.codeChallengeMethod).toBe("S256");
    expect(JSON.stringify(request)).not.toContain("client_secret");
  });

  it("asks Zoho for offline refresh support without forcing repeated consent", () => {
    const request = buildZohoAuthorizationRequest({
      clientId: "zoho-native-client",
      redirectUri: "egitcommand://auth/callback",
      scopes: ["AaaServer.profile.READ"],
      state: "state-1",
    });

    expect(request.accessType).toBe("offline");
    expect(request.prompt).toBeUndefined();
  });

  it("keeps the native callback aligned with the registered iOS URL scheme", () => {
    expect(MOBILE_AUTH_REDIRECT_URI).toBe("egitcommand://auth/callback");
  });

  it("uses the Command Centre API callback as the Zoho redirect URL", () => {
    expect(
      mobileZohoCallbackUriFor("https://command.egit.com.au/api/mobile/v1"),
    ).toBe("https://command.egit.com.au/api/mobile/v1/auth/callback");
  });
});
