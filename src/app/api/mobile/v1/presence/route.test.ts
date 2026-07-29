import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireMobileAuth } from "@/server/mobile-api/auth";
import { getConfiguredPresenceOverrideRepository } from "@/server/presence/repository";

import { POST } from "./route";

vi.mock("@/server/mobile-api/auth", () => ({
  requireMobileAuth: vi.fn(),
}));

vi.mock("@/server/presence/repository", () => ({
  getConfiguredPresenceOverrideRepository: vi.fn(),
}));

const authMock = vi.mocked(requireMobileAuth);
const repositoryMock = vi.mocked(getConfiguredPresenceOverrideRepository);

describe("mobile presence route", () => {
  beforeEach(() => {
    authMock.mockReturnValue({
      email: "jervy@egit.com.au",
      staffId: "staff-jervy",
    });
    repositoryMock.mockReset();
  });

  it("starts Lunch for the authenticated technician for 30 minutes", async () => {
    const startLunch = vi.fn().mockResolvedValue({
      endsAt: "2026-07-26T02:30:00.000Z",
      id: "lunch",
      startsAt: "2026-07-26T02:00:00.000Z",
      status: "lunch",
      technicianEmail: "jervy@egit.com.au",
    });
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
    await expect(response.json()).resolves.toMatchObject({
      data: {
        override: {
          endsAt: "2026-07-26T02:30:00.000Z",
          status: "lunch",
        },
      },
    });
  });
});
