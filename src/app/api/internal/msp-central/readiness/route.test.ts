import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import { GET } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);

describe("MSP Central readiness route", () => {
  it("requires an approved Command Centre user", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      status: "unauthenticated",
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("returns safe readiness status without secret values", async () => {
    const originalSecret = process.env.MSP_CENTRAL_CLIENT_SECRET;
    const originalRefresh = process.env.MSP_CENTRAL_REFRESH_TOKEN;
    process.env.MSP_CENTRAL_CLIENT_SECRET = "do-not-return";
    process.env.MSP_CENTRAL_REFRESH_TOKEN = "also-secret";
    getCommandCentreAccessMock.mockResolvedValueOnce({
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.env.MSP_CENTRAL_CLIENT_SECRET).toBe(true);
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("also-secret");

    restoreEnv("MSP_CENTRAL_CLIENT_SECRET", originalSecret);
    restoreEnv("MSP_CENTRAL_REFRESH_TOKEN", originalRefresh);
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
