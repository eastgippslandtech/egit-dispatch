import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireMobileAuth } from "@/server/mobile-api/auth";
import { getConfiguredPresenceOverrideRepository } from "@/server/presence/repository";
import { getWallboardSnapshot } from "@/server/presence/service";
import { GET, POST } from "./route";

vi.mock("@/server/mobile-api/auth", () => ({
  requireMobileAuth: vi.fn(),
}));
vi.mock("@/server/presence/repository", () => ({
  getConfiguredPresenceOverrideRepository: vi.fn(),
}));
vi.mock("@/server/presence/service", () => ({
  getWallboardSnapshot: vi.fn(),
}));

const authMock = vi.mocked(requireMobileAuth);
const repositoryMock = vi.mocked(getConfiguredPresenceOverrideRepository);
const snapshotMock = vi.mocked(getWallboardSnapshot);

describe("mobile presence API", () => {
  beforeEach(() => {
    authMock.mockReturnValue({
      email: "jervy@egit.com.au",
      staffId: "staff-jervy",
    });
    snapshotMock.mockResolvedValue({
      dashboard: {
        appointments: [],
        calendarDataSource: "outlook",
        dispatchDataSource: "msp-central",
        healthItems: [],
        requests: [],
        selectedDateLabel: "2026-07-26",
        selectedRequestId: "",
        technicians: [
          {
            active: true,
            displayName: "Jervy",
            id: "tech-jervy",
            mappingStatus: "mapped",
            outlookEmail: "jervy@egit.com.au",
            storeLocation: "Bairnsdale",
            zohoEmail: "jervy@egit.com.au",
          },
        ],
        timezone: "Australia/Melbourne",
      },
      peopleStatus: "not_configured",
      presences: [
        {
          conflicts: [],
          context: "Bairnsdale",
          label: "In office",
          source: "schedule",
          status: "in_office",
          technicianId: "tech-jervy",
        },
      ],
      sourceWarnings: [],
      updatedAt: "2026-07-26T02:00:00.000Z",
    });
  });

  it("returns only the authenticated technician's presence", async () => {
    const response = await GET(
      new Request("https://command.egit.com.au/api/mobile/v1/presence"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        presence: {
          status: "in_office",
          technicianId: "tech-jervy",
        },
      },
    });
  });

  it("starts Lunch only for the authenticated technician", async () => {
    const startLunch = vi.fn().mockResolvedValue({ id: "lunch", status: "lunch" });
    repositoryMock.mockReturnValue({
      clear: vi.fn(),
      listActive: vi.fn(),
      setLeave: vi.fn(),
      startLunch,
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/mobile/v1/presence", {
        body: JSON.stringify({ action: "start_lunch" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(startLunch).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByEmail: "jervy@egit.com.au",
        source: "technician_app",
        technicianEmail: "jervy@egit.com.au",
      }),
    );
  });

  it("returns an auth error when the bearer token is invalid", async () => {
    authMock.mockImplementationOnce(() => {
      throw new Error("Mobile bearer token is invalid.");
    });

    const response = await GET(
      new Request("https://command.egit.com.au/api/mobile/v1/presence"),
    );

    expect(response.status).toBe(401);
  });
});
