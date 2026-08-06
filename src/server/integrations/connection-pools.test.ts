import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock } = vi.hoisted(() => ({
  clientMock: vi.fn(() => ({ begin: vi.fn(), json: vi.fn() })),
}));

vi.mock("@/server/database/client", () => ({
  getSharedPostgresClient: clientMock,
}));

describe("integration repository database connection pool", () => {
  beforeEach(() => {
    vi.resetModules();
    clientMock.mockClear();
  });

  it("uses an isolated pool for durable writeback state", async () => {
    const { createPostgresIntegrationRepository } = await import("./repository");

    createPostgresIntegrationRepository({ databaseUrl: "postgresql://example" });

    expect(clientMock).toHaveBeenCalledWith("postgresql://example", "require", {
      max: 2,
      poolKey: "integration-operations",
    });
  });
});
