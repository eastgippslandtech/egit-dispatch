import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock } = vi.hoisted(() => ({
  clientMock: vi.fn(() => ({ begin: vi.fn(), json: vi.fn() })),
}));

vi.mock("@/server/database/client", () => ({
  getSharedPostgresClient: clientMock,
}));

describe("MSP Central database connection pools", () => {
  beforeEach(() => {
    vi.resetModules();
    clientMock.mockClear();
  });

  it("isolates request snapshots from the default app database lane", async () => {
    const { getConfiguredMspRequestSnapshotStore } = await import(
      "./request-snapshot"
    );

    getConfiguredMspRequestSnapshotStore({
      databaseUrl: "postgresql://example",
      portal: "memsp1783593801295",
    });

    expect(clientMock).toHaveBeenCalledWith("postgresql://example", "require", {
      max: 2,
      poolKey: "msp-request-snapshots",
    });
  });

  it("isolates OAuth token coordination from request snapshot reads", async () => {
    const { getConfiguredMspOAuthTokenStore } = await import("./token-store");

    getConfiguredMspOAuthTokenStore("postgresql://example");

    expect(clientMock).toHaveBeenCalledWith("postgresql://example", "require", {
      max: 2,
      poolKey: "msp-oauth-tokens",
    });
  });
});
