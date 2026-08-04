import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import { GET } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

const accessMock = vi.mocked(getCommandCentreAccess);

describe("MSP Central OAuth start route", () => {
  it("only allows the Command Centre admin to replace service credentials", async () => {
    accessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "mattd@egit.com.au",
      status: "approved",
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("redirects the admin to Zoho with a protected callback state", async () => {
    accessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    process.env.APP_BASE_URL = "https://command.egit.com.au";
    process.env.MSP_CENTRAL_ACCOUNTS_URL = "https://accounts.zoho.com.au";
    process.env.MSP_CENTRAL_CLIENT_ID = "client-id";

    const response = await GET();
    const target = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(307);
    expect(target.pathname).toBe("/oauth/v2/auth");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://command.egit.com.au/api/internal/msp-central/oauth/callback",
    );
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain("msp_oauth_state=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
