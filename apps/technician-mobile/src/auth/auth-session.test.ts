import { describe, expect, it } from "vitest";

import {
  MOBILE_AUTH_REDIRECT_URI,
  buildZohoAuthorizationRequest,
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

  it("asks Zoho for an explicit consent prompt and offline refresh support", () => {
    const request = buildZohoAuthorizationRequest({
      clientId: "zoho-native-client",
      redirectUri: "egitcommand://auth/callback",
      scopes: ["AaaServer.profile.READ"],
      state: "state-1",
    });

    expect(request.accessType).toBe("offline");
    expect(request.prompt).toBe("consent");
  });

  it("keeps the native callback aligned with the registered iOS URL scheme", () => {
    expect(MOBILE_AUTH_REDIRECT_URI).toBe("egitcommand://auth/callback");
  });
});
