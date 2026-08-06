import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientMock } = vi.hoisted(() => ({
  clientMock: vi.fn(() => ({ json: vi.fn() })),
}));

vi.mock("@/server/database/client", () => ({
  getSharedPostgresClient: clientMock,
}));

describe("notification repository database connection pool", () => {
  beforeEach(() => {
    vi.resetModules();
    clientMock.mockClear();
  });

  it("uses an isolated pool for mobile notification state", async () => {
    const { getConfiguredNotificationRepository } = await import("./repository");

    getConfiguredNotificationRepository("postgresql://example");

    expect(clientMock).toHaveBeenCalledWith("postgresql://example", "require", {
      max: 2,
      poolKey: "notification-state",
    });
  });
});
