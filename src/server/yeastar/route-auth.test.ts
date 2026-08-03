import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";

import { cronAuthorized, dispatchRouteAccess } from "./route-auth";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

const getAccess = vi.mocked(getCommandCentreAccess);

describe("cron authorization", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses timing-safe comparison after checking UTF-8 byte lengths", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "route-auth.ts"), "utf8");

    expect(source).toContain('from "node:crypto"');
    expect(source).toContain("timingSafeEqual");
    expect(source).toMatch(/actual\.length\s*!==\s*expected\.length/);
  });

  it("authorizes an exact integration secret and rejects different values", () => {
    vi.stubEnv("INTEGRATION_CRON_SECRET", "integration-secret");
    vi.stubEnv("CRON_SECRET", "fallback-secret");

    expect(cronAuthorized(request("integration-secret"))).toBe(true);
    expect(cronAuthorized(request("integration-secreu"))).toBe(false);
    expect(cronAuthorized(request("short"))).toBe(false);
  });

  it("prefers INTEGRATION_CRON_SECRET and falls back to CRON_SECRET", () => {
    vi.stubEnv("INTEGRATION_CRON_SECRET", "primary-secret");
    vi.stubEnv("CRON_SECRET", "fallback-secret");
    expect(cronAuthorized(request("primary-secret"))).toBe(true);
    expect(cronAuthorized(request("fallback-secret"))).toBe(false);

    vi.stubEnv("INTEGRATION_CRON_SECRET", "   ");
    expect(cronAuthorized(request("fallback-secret"))).toBe(true);
  });

  it("fails closed when configuration or authorization is missing", () => {
    vi.stubEnv("INTEGRATION_CRON_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    expect(cronAuthorized(request("anything"))).toBe(false);

    vi.stubEnv("CRON_SECRET", "configured-secret");
    expect(cronAuthorized(new Request("https://command.egit.com.au/cron"))).toBe(false);
  });
});

describe("dispatch route access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows an approved staff profile with dispatch enabled", async () => {
    getAccess.mockResolvedValue({
      accessLevel: "staff",
      email: "jervy@egit.com.au",
      name: "Jervy",
      status: "approved",
    });

    await expect(dispatchRouteAccess()).resolves.toMatchObject({
      email: "jervy@egit.com.au",
    });
  });

  it("rejects approved accounts without a dispatch-enabled staff profile", async () => {
    getAccess.mockResolvedValue({
      accessLevel: "staff",
      email: "unknown@egit.com.au",
      name: "Unknown",
      status: "approved",
    });

    await expect(dispatchRouteAccess()).resolves.toBeNull();
  });
});

function request(secret: string) {
  return new Request("https://command.egit.com.au/cron", {
    headers: { authorization: `Bearer ${secret}` },
  });
}
