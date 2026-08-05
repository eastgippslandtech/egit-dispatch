import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

import { GET } from "./route";

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));
vi.mock("@/server/yeastar/route-auth", () => ({ staffRouteAccess: vi.fn() }));

const access = vi.mocked(staffRouteAccess);
const createRepository = vi.mocked(createPostgresIntegrationRepository);
const getHealth = vi.fn();
const getOperationCounts = vi.fn();

describe("integration health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue({
      accessLevel: "staff",
      email: "jervy@egit.com.au",
      name: "Jervy",
      status: "approved",
    });
    getHealth.mockResolvedValue([
      {
        connector: "msp_central",
        consecutiveFailures: 2,
        lastError: "Authorization: Bearer private-token request timed out",
        lastReadAt: "2026-08-03T09:00:00.000Z",
        lastWriteAt: "2026-08-03T09:05:00.000Z",
        status: "degraded",
      },
    ]);
    getOperationCounts.mockResolvedValue({ pending: 4, reviewRequired: 2 });
    createRepository.mockReturnValue({ getHealth, getOperationCounts } as never);
  });

  it("allows any approved staff member and disables caching", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.counts).toEqual({ pending: 4, reviewRequired: 2 });
    expect(payload.connectors[0]).toMatchObject({
      connector: "msp_central",
      lastReadAt: "2026-08-03T09:00:00.000Z",
      lastWriteAt: "2026-08-03T09:05:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("private-token");
  });

  it("rejects non-staff access", async () => {
    access.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(createRepository).not.toHaveBeenCalled();
  });

  it("keeps recovery counts when the health store is unavailable", async () => {
    getHealth.mockRejectedValueOnce(new Error("write CONNECT_TIMEOUT"));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.counts).toEqual({ pending: 4, reviewRequired: 2 });
    expect(payload.connectors).toEqual([
      expect.objectContaining({
        connector: "command_centre",
        status: "unavailable",
      }),
    ]);
    expect(payload.warning).toContain("CONNECT_TIMEOUT");
  });

  it("keeps connector health when recovery counts are unavailable", async () => {
    getOperationCounts.mockRejectedValueOnce(new Error("read timeout"));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.counts).toEqual({ pending: 0, reviewRequired: 0 });
    expect(payload.connectors[0]).toMatchObject({
      connector: "msp_central",
      status: "degraded",
    });
    expect(payload.warning).toContain("read timeout");
  });
});
