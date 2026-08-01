import { describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createMspCentralClient } from "@/server/msp-central/client";

import { POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

const getCommandCentreAccessMock = vi.mocked(getCommandCentreAccess);
const createMspCentralClientMock = vi.mocked(createMspCentralClient);

describe("MSP Central merge requests route", () => {
  it("rejects a wallboard-only session", async () => {
    getCommandCentreAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/merge-requests",
        {
          body: "{}",
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(403);
  });

  it("rejects merging a request into itself", async () => {
    const mergeRequests = vi.fn();
    getCommandCentreAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    createMspCentralClientMock.mockReturnValue(
      mspClientWith({ mergeRequests }),
    );

    const response = await POST(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/merge-requests",
        {
          body: JSON.stringify({
            childRequestId: "123",
            parentRequestId: "123",
          }),
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(mergeRequests).not.toHaveBeenCalled();
  });

  it("merges the duplicate child into the surviving parent", async () => {
    const mergeRequests = vi.fn().mockResolvedValue(undefined);
    getCommandCentreAccessMock.mockResolvedValueOnce({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    createMspCentralClientMock.mockReturnValue(
      mspClientWith({ mergeRequests }),
    );

    const response = await POST(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/merge-requests",
        {
          body: JSON.stringify({
            childRequestId: "duplicate-123",
            parentRequestId: "surviving-456",
          }),
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      childRequestId: "duplicate-123",
      ok: true,
      parentRequestId: "surviving-456",
    });
    expect(mergeRequests).toHaveBeenCalledWith({
      childRequestId: "duplicate-123",
      parentRequestId: "surviving-456",
    });
  });
});

function mspClientWith({
  mergeRequests,
}: {
  mergeRequests: ReturnType<typeof vi.fn>;
}) {
  return {
    getRequest: vi.fn(),
    getTechnician: vi.fn(),
    listCustomers: vi.fn(),
    listRequests: vi.fn(),
    listSites: vi.fn(),
    listTechnicians: vi.fn(),
    mergeRequests,
    refreshAccessToken: vi.fn(),
    updateRequestSchedule: vi.fn(),
  };
}
