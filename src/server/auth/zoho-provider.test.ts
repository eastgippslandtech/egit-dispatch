import { describe, expect, it } from "vitest";

import { createZohoProvider } from "./zoho-provider";

describe("createZohoProvider", () => {
  it("uses the AU Zoho accounts host for Command Centre login", () => {
    const provider = createZohoProvider({
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(provider.authorization).toBe(
      "https://accounts.zoho.com.au/oauth/v2/auth?scope=AaaServer.profile.Read",
    );
    expect(provider.token).toBe("https://accounts.zoho.com.au/oauth/v2/token");
    expect(provider.userinfo).toBe(
      "https://accounts.zoho.com.au/oauth/user/info",
    );
  });

  it("keeps future fixed Zoho account hosts configurable", () => {
    const provider = createZohoProvider({
      accountsUrl: "https://accounts.zoho.com",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(provider.authorization).toBe(
      "https://accounts.zoho.com/oauth/v2/auth?scope=AaaServer.profile.Read",
    );
    expect(provider.token).toBe("https://accounts.zoho.com/oauth/v2/token");
    expect(provider.userinfo).toBe("https://accounts.zoho.com/oauth/user/info");
  });
});
