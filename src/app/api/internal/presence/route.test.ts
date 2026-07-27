import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCommandCentreAccess,
  getWallboardAccess,
} from "@/server/auth/session";
import { getEmptyCommandCentreData } from "@/server/dispatch/mock-data";
import { getConfiguredPresenceOverrideRepository } from "@/server/presence/repository";
import { getWallboardSnapshot } from "@/server/presence/service";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";
import { GET, POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
  getWallboardAccess: vi.fn(),
}));
vi.mock("@/server/presence/repository", () => ({
  getConfiguredPresenceOverrideRepository: vi.fn(),
}));
vi.mock("@/server/presence/service", () => ({
  getWallboardSnapshot: vi.fn(),
}));

const accessMock = vi.mocked(getCommandCentreAccess);
const wallboardAccessMock = vi.mocked(getWallboardAccess);
const repositoryMock = vi.mocked(getConfiguredPresenceOverrideRepository);
const snapshotMock = vi.mocked(getWallboardSnapshot);
const technician = staffProfileToTechnician(getInitialStaffProfiles()[2]);
const snapshot = {
  dashboard: {
    ...getEmptyCommandCentreData(),
    technicians: [technician],
  },
  peopleStatus: "not_configured" as const,
  presences: [],
  sourceWarnings: [],
  updatedAt: "2026-07-26T02:00:00.000Z",
};

describe("internal presence API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    accessMock.mockResolvedValue({
      email: "simeon@egit.com.au",
      status: "approved",
    });
    wallboardAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      status: "approved",
    });
    snapshotMock.mockResolvedValue(snapshot);
  });

  it("requires an approved Command Centre user", async () => {
    wallboardAccessMock.mockResolvedValueOnce({ status: "unauthenticated" });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns a no-store wallboard snapshot", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("returns the wallboard snapshot for a signed wallboard session", async () => {
    wallboardAccessMock.mockResolvedValueOnce({
      accessLevel: "wallboard",
      name: "Command Centre Wallboard",
      status: "approved",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(wallboardAccessMock).toHaveBeenCalledOnce();
    expect(accessMock).not.toHaveBeenCalled();
  });

  it("rejects presence writes from a signed wallboard session", async () => {
    accessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/presence", {
        body: "{}",
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it("starts a 30-minute Lunch for an enabled technician", async () => {
    const startLunch = vi.fn().mockResolvedValue({ id: "lunch", status: "lunch" });
    repositoryMock.mockReturnValue({
      clear: vi.fn(),
      listActive: vi.fn(),
      setLeave: vi.fn(),
      startLunch,
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/presence", {
        body: JSON.stringify({
          action: "start_lunch",
          technicianId: technician.id,
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(startLunch).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByEmail: "simeon@egit.com.au",
        source: "dispatch",
        technicianEmail: "jervy@egit.com.au",
      }),
    );
  });

  it("validates manual Leave and rejects unknown technicians", async () => {
    repositoryMock.mockReturnValue({
      clear: vi.fn(),
      listActive: vi.fn(),
      setLeave: vi.fn(),
      startLunch: vi.fn(),
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/presence", {
        body: JSON.stringify({
          action: "set_leave",
          endsAt: "2026-07-27T07:30:00.000Z",
          reason: "Annual leave",
          technicianId: "missing-tech",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Technician is not enabled for Command Centre presence.",
    });
  });
});
