import { describe, expect, it } from "vitest";

import type { DispatchDashboardData } from "@/server/dispatch/types";

import {
  DASHBOARD_CACHE_MAX_AGE_MS,
  readCachedDashboard,
  resolveDashboardWithCache,
  shouldCacheDashboard,
} from "./dashboard-cache";

const healthyDashboard: DispatchDashboardData = {
  appointments: [
    {
      customer: "EGIT",
      date: "2026-08-04",
      end: "11:00",
      id: "appointment-cached",
      source: "linked",
      start: "10:00",
      status: "confirmed",
      technicianId: "tech-simeon",
      title: "Cached appointment",
    },
  ],
  calendarDataSource: "outlook",
  calendarReadOnly: false,
  calendarStatusLabel: "Outlook Read/Write",
  dispatchDataSource: "msp-central",
  healthItems: [],
  requests: [
    {
      ageHours: 1,
      billable: false,
      contact: "help@example.com",
      customer: "EGIT",
      dueAt: "2026-08-04T01:00:00.000Z",
      id: "request-cached",
      priority: "High",
      readyToBook: true,
      requester: "Customer",
      requestNumber: "REQ-CACHED",
      site: "Bairnsdale",
      slaState: "normal",
      sourceSystem: "msp-central",
      status: "Open",
      subject: "Cached request",
      warnings: [],
    },
  ],
  selectedDateLabel: "Tuesday 4 August 2026",
  selectedRequestId: "request-cached",
  technicians: [
    {
      active: true,
      baseOfficeAddress: "137 Main Street, Bairnsdale VIC 3875",
      baseOfficeId: "bairnsdale",
      baseOfficeName: "Bairnsdale",
      displayName: "Simeon",
      id: "tech-simeon",
      mappingStatus: "mapped",
      outlookEmail: "simeon@egit.com.au",
      outlookUserPrincipalName: "simeon@egit.com.au",
      role: "admin",
    },
  ],
  timezone: "Australia/Melbourne",
};

describe("Command Centre local dashboard cache", () => {
  it("restores cached requests and appointments when both integrations fail", () => {
    const failedDashboard: DispatchDashboardData = {
      ...healthyDashboard,
      appointments: [],
      calendarError:
        "MSP Central is temporarily unavailable. Helpdesk requests could not be loaded. Outlook calendar read failed.",
      requests: [],
      selectedRequestId: "",
    };

    const resolved = resolveDashboardWithCache(failedDashboard, {
      dashboard: healthyDashboard,
      savedAt: "2026-08-04T00:35:00.000Z",
      version: 1,
    });

    expect(resolved.requests).toEqual(healthyDashboard.requests);
    expect(resolved.appointments).toEqual(healthyDashboard.appointments);
    expect(resolved.selectedRequestId).toBe("request-cached");
    expect(resolved.calendarError).toContain(
      "Showing cached Command Centre data from",
    );
  });

  it("keeps live Outlook appointments when only MSP Central fails", () => {
    const liveAppointment = {
      ...healthyDashboard.appointments[0],
      id: "appointment-live",
      title: "Live Outlook appointment",
    };
    const partialDashboard: DispatchDashboardData = {
      ...healthyDashboard,
      appointments: [liveAppointment],
      calendarError:
        "MSP Central is temporarily unavailable. Helpdesk requests could not be loaded.",
      requests: [],
      selectedRequestId: "",
    };

    const resolved = resolveDashboardWithCache(partialDashboard, {
      dashboard: healthyDashboard,
      savedAt: "2026-08-04T00:35:00.000Z",
      version: 1,
    });

    expect(resolved.requests).toEqual(healthyDashboard.requests);
    expect(resolved.appointments).toEqual([liveAppointment]);
  });

  it("does not replace a healthy empty board with old data", () => {
    const healthyEmptyDashboard: DispatchDashboardData = {
      ...healthyDashboard,
      appointments: [],
      requests: [],
      selectedRequestId: "",
    };

    expect(
      resolveDashboardWithCache(healthyEmptyDashboard, {
        dashboard: healthyDashboard,
        savedAt: "2026-08-04T00:35:00.000Z",
        version: 1,
      }),
    ).toBe(healthyEmptyDashboard);
  });

  it("keeps the last healthy board when a live dashboard read times out", () => {
    const timedOutDashboard: DispatchDashboardData = {
      ...healthyDashboard,
      appointments: [],
      calendarError:
        "Live Command Centre data could not be loaded quickly. Showing cached Command Centre data when available.",
      requests: [],
      selectedRequestId: "",
    };

    const resolved = resolveDashboardWithCache(timedOutDashboard, {
      dashboard: healthyDashboard,
      savedAt: "2026-08-04T00:35:00.000Z",
      version: 1,
    });

    expect(resolved.requests).toEqual(healthyDashboard.requests);
    expect(resolved.appointments).toEqual(healthyDashboard.appointments);
    expect(resolved.selectedRequestId).toBe("request-cached");
  });

  it("only stores fully healthy live dashboards", () => {
    expect(shouldCacheDashboard(healthyDashboard)).toBe(true);
    expect(
      shouldCacheDashboard({
        ...healthyDashboard,
        calendarError: "Outlook calendar read failed.",
      }),
    ).toBe(false);
  });

  it("rejects a browser snapshot after seven days", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          dashboard: healthyDashboard,
          savedAt: "2026-08-04T00:00:00.000Z",
          version: 1,
        }),
      removeItem: () => undefined,
      setItem: () => undefined,
    };

    expect(
      readCachedDashboard(
        storage,
        new Date("2026-08-04T00:00:00.000Z").getTime() +
          DASHBOARD_CACHE_MAX_AGE_MS +
          1,
      ),
    ).toBeNull();
  });
});
