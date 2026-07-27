import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { getGraphHealthStatus } from "@/server/graph/health";

import { GET } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/graph/health", () => ({
  getGraphHealthStatus: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const getGraphHealthStatusMock = vi.mocked(getGraphHealthStatus);

describe("Graph health route", () => {
  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });
    getGraphHealthStatusMock.mockResolvedValueOnce({
      calendarReadsSucceeded: 0,
      configuredTechnicians: 0,
      env: {
        MICROSOFT_CLIENT_ID: false,
        MICROSOFT_CLIENT_SECRET: false,
        MICROSOFT_TENANT_ID: false,
      },
      errors: [],
      ok: true,
      tokenAcquisitionSucceeded: false,
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(getGraphHealthStatusMock).not.toHaveBeenCalled();
  });
});
