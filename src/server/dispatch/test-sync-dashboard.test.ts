import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDispatchDashboardData } from "./provider";
import { listDispatchTestSyncEvents } from "./test-sync";
import {
  getTestSyncedDispatchDashboardData,
  resetTestSyncedDashboardCacheForTests,
} from "./test-sync-dashboard";
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
    resetTestSyncedDashboardCacheForTests();
    process.env.DATABASE_URL = "postgresql://example";
    getDispatchDashboardDataMock.mockResolvedValue(dashboard);
  });

  afterEach(() => {
    resetTestSyncedDashboardCacheForTests();
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

  it("does not reintroduce resolved test-sync requests in live MSP Central mode", async () => {
    getDispatchDashboardDataMock.mockResolvedValue({
      ...dashboard,
      dispatchDataSource: "msp-central",
    });
    listDispatchTestSyncEventsMock.mockResolvedValue([
      {
        createdAt: "2026-07-08T00:00:00.000Z",
        eventType: "work_logged",
        id: "event-resolved",
        requestId: "req-1",
        payload: {
          workLog: {
            billable: true,
            minutesSpent: 30,
            notes: "Completed during testing.",
            status: "Resolved",
            visibility: "Customer-facing",
            workType: "Remote",
          },
        },
      },
    ]);

    const result = await getTestSyncedDispatchDashboardData();

    expect(result.requests).toEqual([]);
    expect(result.selectedRequestId).toBe("");
  });

  it("skips local test-sync overlays in full live MSP Central mode", async () => {
    getDispatchDashboardDataMock.mockResolvedValue({
      ...dashboard,
      dispatchDataSource: "msp-central",
    });
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

    await expect(
      getTestSyncedDispatchDashboardData({
        appBaseUrl: "https://command.egit.com.au",
        calendarDataSource: "outlook",
        databaseUrl: "postgresql://example",
        dispatchDataSource: "msp-central",
        microsoft: {
          clientId: "graph-client",
          clientSecret: "graph-secret",
          tenantId: "graph-tenant",
          timezone: "Australia/Melbourne",
        },
        mode: "live",
        mspCentral: {
          baseUrl: "https://servicedeskplus.net.au",
          clientId: "msp-client",
          clientSecret: "msp-secret",
          portal: "memsp1783593801295",
          refreshToken: "msp-refresh",
        },
        timezone: "Australia/Melbourne",
        trainingSamplesEnabled: false,
      }),
    ).resolves.toMatchObject({
      requests: dashboard.requests,
      selectedRequestId: "req-1",
    });
    expect(listDispatchTestSyncEventsMock).not.toHaveBeenCalled();
  });

  it("leaves the dashboard unchanged when no test database is configured", async () => {
    delete process.env.DATABASE_URL;

    await expect(getTestSyncedDispatchDashboardData()).resolves.toBe(dashboard);
    expect(listDispatchTestSyncEventsMock).not.toHaveBeenCalled();
  });

  it("returns a loadable fallback when the live dashboard read stalls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getDispatchDashboardDataMock.mockReturnValue(
      new Promise(() => undefined),
    );
    listDispatchTestSyncEventsMock.mockResolvedValue([]);

    const result = await getTestSyncedDispatchDashboardData(
      {
        appBaseUrl: "https://command.egit.com.au",
        calendarDataSource: "outlook",
        databaseUrl: "postgresql://example",
        dispatchDataSource: "msp-central",
        microsoft: {
          clientId: "graph-client",
          clientSecret: "graph-secret",
          tenantId: "graph-tenant",
          timezone: "Australia/Melbourne",
        },
        mode: "live",
        mspCentral: {
          baseUrl: "https://servicedeskplus.net.au",
          clientId: "msp-client",
          clientSecret: "msp-secret",
          portal: "memsp1783593801295",
          refreshToken: "msp-refresh",
        },
        timezone: "Australia/Melbourne",
        trainingSamplesEnabled: false,
      },
      undefined,
      { dashboardTimeoutMs: 1, overlayTimeoutMs: 1 },
    );

    expect(result.dispatchDataSource).toBe("msp-central");
    expect(result.calendarDataSource).toBe("outlook");
    expect(result.calendarError).toContain(
      "Live Command Centre data could not be loaded quickly",
    );
    expect(result.requests).toEqual([]);
    expect(result.technicians.map((technician) => technician.displayName)).toEqual(
      ["Matt", "Jervy", "Riley", "Simeon"],
    );
    expect(console.error).toHaveBeenCalledWith(
      "Dispatch dashboard read failed",
      { message: "Command Centre live dashboard read timed out." },
    );
  });

  it("allows live dashboard reads long enough for Outlook's dashboard budget", async () => {
    vi.useFakeTimers();
    getDispatchDashboardDataMock.mockReturnValue(
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              ...dashboard,
              calendarDataSource: "outlook",
              dispatchDataSource: "msp-central",
            }),
          12_500,
        );
      }),
    );

    const resultPromise = getTestSyncedDispatchDashboardData({
      appBaseUrl: "https://command.egit.com.au",
      calendarDataSource: "outlook",
      databaseUrl: "postgresql://example",
      dispatchDataSource: "msp-central",
      microsoft: {
        clientId: "graph-client",
        clientSecret: "graph-secret",
        tenantId: "graph-tenant",
        timezone: "Australia/Melbourne",
      },
      mode: "live",
      mspCentral: {
        baseUrl: "https://servicedeskplus.net.au",
        clientId: "msp-client",
        clientSecret: "msp-secret",
        portal: "memsp1783593801295",
        refreshToken: "msp-refresh",
      },
      timezone: "Australia/Melbourne",
      trainingSamplesEnabled: false,
    });

    await vi.advanceTimersByTimeAsync(12_501);

    const result = await resultPromise;

    expect(result).toMatchObject({
      calendarDataSource: "outlook",
      requests: dashboard.requests,
    });
    expect(result.calendarError).toBeUndefined();
  });
});
