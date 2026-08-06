import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("mobile auth callback route", () => {
  it("hands Zoho's HTTPS callback back to the native app scheme", async () => {
    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/mobile/v1/auth/callback?state=state-1&code=auth-code-1&location=au&accounts-server=https%3A%2F%2Faccounts.zoho.com.au",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "egitcommand://auth/callback?state=state-1&code=auth-code-1&location=au&accounts-server=https%3A%2F%2Faccounts.zoho.com.au",
    );
  });
});
