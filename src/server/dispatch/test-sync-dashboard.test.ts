import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDispatchDashboardData } from "./provider";
import { listDispatchTestSyncEvents } from "./test-sync";
import { getTestSyncedDispatchDashboardData } from "./test-sync-dashboard";
import type { DispatchDashboardData } from "./types";

vi.mock("./provider", () => ({
  getDispatchDashboardData: vi.fn(),
}));

vi.mock("./test-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./test-sync")>();

  return {
    ...actual,
    listDispatchTestSyncEvents: vi.fn(),
  };
});

const getDispatchDashboardDataMock = vi.mocked(getDispatchDashboardData);
const listDispatchTestSyncEventsMock = vi.mocked(listDispatchTestSyncEvents);

const dashboard: DispatchDashboardData = {
  appointments: [],
  healthItems: [],
  requests: [
    {
      ageHours: 2,
      billable: true,
      contact: "mel@example.com",
      customer: "OneHarvest",
      dueAt: "2026-07-08T00:30:00.000Z",
      id: "req-1",
      priority: "High",
      readyToBook: true,
      requestNumber: "REQ-1",
      requester: "Mel",
      site: "Packing floor",
      slaState: "due-soon",
      status: "Ready for Scheduling",
      subject: "Printer offline",
      warnings: [],
    },
  ],
  selectedDateLabel: "Wednesday 8 July 2026",
  selectedRequestId: "req-1",
  technicians: [
    {
      active: true,
      displayName: "Matt",
      id: "matt",
      mappingStatus: "mapped",
      outlookEmail: "mattd@egit.com.au",
      storeLocation: "Sale",
    },
  ],
  timezone: "Australia/Melbourne",
};

describe("test-synced dispatch dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://example";
    getDispatchDashboardDataMock.mockResolvedValue(dashboard);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    vi.restoreAllMocks();
  });

  it("applies stored dispatcher test-sync events for refresh loads", async () => {
    listDispatchTestSyncEventsMock.mockResolvedValue([
      {
        appointmentId: "appt-test",
        createdAt: "2026-07-08T00:00:00.000Z",
        date: "2026-07-08",
        end: "10:00",
        eventType: "scheduled",
        id: "event-1",
        requestId: "req-1",
        start: "09:00",
        technicianId: "matt",
      },
    ]);

    const result = await getTestSyncedDispatchDashboardData();

    expect(result.requests[0]).toMatchObject({
      readyToBook: false,
      scheduledEnd: "2026-07-08T10:00:00+10:00",
      scheduledStart: "2026-07-08T09:00:00+10:00",
      status: "Scheduled",
      technicianId: "matt",
    });
    expect(result.appointments).toContainEqual(
      expect.objectContaining({
        id: "appt-test",
        requestId: "req-1",
        start: "09:00",
      }),
    );
  });

  it("loads persisted schedule changes in parallel with the dashboard", async () => {
    let resolveDashboard: ((value: DispatchDashboardData) => void) | undefined;
    getDispatchDashboardDataMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDashboard = resolve;
      }),
    );
    listDispatchTestSyncEventsMock.mockResolvedValue([]);

    const pendingDashboard = getTestSyncedDispatchDashboardData();
    await Promise.resolve();

    expect(listDispatchTestSyncEventsMock).toHaveBeenCalledOnce();

    resolveDashboard?.(dashboard);
    await expect(pendingDashboard).resolves.toEqual(dashboard);
  });

  it("leaves the dashboard unchanged when no test database is configured", async () => {
    delete process.env.DATABASE_URL;

    await expect(getTestSyncedDispatchDashboardData()).resolves.toBe(dashboard);
    expect(listDispatchTestSyncEventsMock).not.toHaveBeenCalled();
  });
});
