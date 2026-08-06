import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("auth env example", () => {
  const envExample = readFileSync(".env.example", "utf8");

  it("documents Auth.js and NextAuth secret/url aliases", () => {
    expect(envExample).toContain("APP_BASE_URL=http://localhost:3000");
    expect(envExample).toContain("AUTH_URL=http://localhost:3000");
    expect(envExample).toContain("AUTH_SECRET=");
    expect(envExample).toContain("NEXTAUTH_URL=http://localhost:3000");
    expect(envExample).toContain("NEXTAUTH_SECRET=");
  });

  it("keeps Zoho app login separate from future MSP Central service OAuth", () => {
    expect(envExample).toContain("ZOHO_CLIENT_ID=");
    expect(envExample).toContain("ZOHO_CLIENT_SECRET=");
    expect(envExample).toContain("ZOHO_ACCOUNTS_URL=https://accounts.zoho.com.au");
    expect(envExample).toContain(
      "ALLOWED_AUTH_EMAILS=simeon@egit.com.au,mattd@egit.com.au,jervy@egit.com.au,riley@egit.com.au",
    );
    expect(envExample).toContain("CALENDAR_DATA_SOURCE=mock");
    expect(envExample).toContain("DISPATCH_DATA_SOURCE=mock");
    expect(envExample).toContain("GRAPH_CALENDAR_TIMEZONE=Australia/Melbourne");
    expect(envExample).toContain("MSP_CENTRAL_CLIENT_ID=");
    expect(envExample).toContain("MSP_CENTRAL_REFRESH_TOKEN=");
  });
});
