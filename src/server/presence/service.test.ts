import { describe, expect, it, vi } from "vitest";

import { getEmptyCommandCentreData } from "@/server/dispatch/mock-data";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";
import { getWallboardSnapshot } from "./service";

const technician = staffProfileToTechnician(getInitialStaffProfiles()[2]);

describe("wallboard snapshot service", () => {
  it("loads presence overrides in parallel with the dispatch dashboard", async () => {
    const dashboard = {
      ...getEmptyCommandCentreData(),
      appointments: [],
      technicians: [technician],
    };
    let resolveDashboard:
      | ((value: typeof dashboard) => void)
      | undefined;
    const listActive = vi.fn().mockResolvedValue([]);
    const snapshotPromise = getWallboardSnapshot({
      getDashboard: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDashboard = resolve;
          }),
      ),
      now: new Date("2026-07-26T02:15:00.000Z"),
      peopleConfig: null,
      repository: { listActive },
    });
    await Promise.resolve();

    expect(listActive).toHaveBeenCalledOnce();

    resolveDashboard?.(dashboard);
    await snapshotPromise;
  });

  it("combines the live dashboard and active overrides into presence", async () => {
    const dashboard = {
      ...getEmptyCommandCentreData(),
      appointments: [],
      technicians: [technician],
    };

    const snapshot = await getWallboardSnapshot({
      getDashboard: vi.fn().mockResolvedValue(dashboard),
      now: new Date("2026-07-26T02:15:00.000Z"),
      peopleConfig: null,
      repository: {
        listActive: vi.fn().mockResolvedValue([
          {
            createdAt: "2026-07-26T02:00:00.000Z",
            createdByEmail: "jervy@egit.com.au",
            endsAt: "2026-07-26T02:30:00.000Z",
            id: "lunch",
            source: "dispatch",
            startsAt: "2026-07-26T02:00:00.000Z",
            status: "lunch",
            technicianEmail: "jervy@egit.com.au",
          },
        ]),
      },
    });

    expect(snapshot).toMatchObject({
      peopleStatus: "not_configured",
      presences: [
        {
          remainingMinutes: 15,
          status: "lunch",
          technicianId: technician.id,
        },
      ],
      sourceWarnings: [],
      weeklyExternalTalkSeconds: {},
      updatedAt: "2026-07-26T02:15:00.000Z",
    });
  });

  it("keeps the calendar available when Zoho People fails", async () => {
    const dashboard = {
      ...getEmptyCommandCentreData(),
      appointments: [],
      technicians: [technician],
    };

    const snapshot = await getWallboardSnapshot({
      getDashboard: vi.fn().mockResolvedValue(dashboard),
      now: new Date("2026-07-26T23:15:00.000Z"),
      peopleClient: {
        listApprovedLeave: vi.fn().mockRejectedValue(new Error("People offline")),
      },
      peopleConfig: {
        accountsUrl: "https://accounts.zoho.com.au",
        apiBaseUrl: "https://people.zoho.com.au",
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
      },
      repository: {
        listActive: vi.fn().mockResolvedValue([]),
      },
    });

    expect(snapshot.peopleStatus).toBe("unavailable");
    expect(snapshot.presences[0]).toMatchObject({ status: "in_office" });
    expect(snapshot.sourceWarnings).toContain(
      "Zoho People leave is temporarily unavailable.",
    );
  });

  it("keeps the wallboard responsive when optional presence sources stall", async () => {
    const dashboard = {
      ...getEmptyCommandCentreData(),
      appointments: [],
      technicians: [technician],
    };

    const snapshot = await getWallboardSnapshot({
      auxiliaryTimeoutMs: 1,
      getDashboard: vi.fn().mockResolvedValue(dashboard),
      now: new Date("2026-07-26T02:15:00.000Z"),
      peopleConfig: null,
      repository: {
        listActive: vi.fn(() => new Promise(() => undefined)),
      },
      talkTimeRepository: {
        getWeeklyTalkTotals: vi.fn(() => new Promise(() => undefined)),
      },
    });

    expect(snapshot.presences[0]).toMatchObject({ status: "closed" });
    expect(snapshot.weeklyExternalTalkSeconds).toEqual({});
    expect(snapshot.sourceWarnings).toEqual(
      expect.arrayContaining([
        "Manual presence updates are temporarily unavailable.",
        "External talk-time totals are temporarily unavailable.",
      ]),
    );
  });

  it("redacts private appointment content from the wallboard payload", async () => {
    const dashboard = {
      ...getEmptyCommandCentreData(),
      appointments: [
        {
          bodyPreview: "Medical details",
          customer: "Secret location",
          date: "2026-07-26",
          end: "13:00",
          id: "private-event",
          outlookAttendees: ["doctor@example.com"],
          outlookIssue: "private" as const,
          outlookSensitivity: "private",
          source: "outlook" as const,
          start: "12:00",
          status: "busy" as const,
          technicianId: technician.id,
          title: "Medical appointment",
        },
      ],
      technicians: [technician],
    };

    const snapshot = await getWallboardSnapshot({
      getDashboard: vi.fn().mockResolvedValue(dashboard),
      now: new Date("2026-07-26T02:15:00.000Z"),
      peopleConfig: null,
      repository: {
        listActive: vi.fn().mockResolvedValue([]),
      },
    });

    expect(snapshot.dashboard.appointments[0]).toMatchObject({
      customer: "Private",
      title: "Personal",
    });
    expect(snapshot.dashboard.appointments[0].bodyPreview).toBeUndefined();
    expect(snapshot.dashboard.appointments[0].outlookAttendees).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("Medical");
    expect(JSON.stringify(snapshot)).not.toContain("doctor@example.com");
  });
});
