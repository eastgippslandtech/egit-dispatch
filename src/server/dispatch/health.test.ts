import { describe, expect, it } from "vitest";

import { buildDispatchHealthItems } from "./health";
import { getDispatchDesignMockData } from "./mock-data";
import type { Appointment, DispatchDashboardData, Technician } from "./types";

describe("dispatch health", () => {
  it("derives the Command Centre health bar from requests, appointments, and technician mappings", () => {
    const data = getDispatchDesignMockData();
    const health = buildDispatchHealthItems(data);
    const counts = Object.fromEntries(
      health.map((item) => [item.key, item.count]),
    );

    expect(counts).toMatchObject({
      unscheduled: 15,
      "sla-risk": 6,
      "double-booked": 1,
      "missing-calendar": 1,
      "time-mismatch": 2,
      "past-open": 1,
      mapping: 0,
      "travel-conflicts": 5,
      "out-of-hours": 1,
    });
  });

  it("keeps urgent sync and SLA states visually severe", () => {
    const data = getDispatchDesignMockData();
    const severities = Object.fromEntries(
      buildDispatchHealthItems(data).map((item) => [
        item.key,
        item.severity,
      ]),
    );

    expect(severities["sla-risk"]).toBe("critical");
    expect(severities["double-booked"]).toBe("critical");
    expect(severities["past-open"]).toBe("critical");
    expect(severities["travel-conflicts"]).toBe("warning");
  });

  it("detects Outlook read-only calendar conflicts and review states", () => {
    const technician: Technician = {
      active: true,
      calendarEnabled: true,
      displayName: "Simeon",
      id: "tech-simeon",
      mappingStatus: "mapped",
      outlookEmail: "simeon@egit.com.au",
      storeLocation: "Bairnsdale",
    };
    const appointments: Appointment[] = [
      outlookAppointment("event-1", {
        start: "10:00",
        end: "11:00",
        outlookLinkedRequestNumber: "100211",
        requestId: "100211",
      }),
      outlookAppointment("event-2", {
        start: "10:30",
        end: "11:30",
        outlookIssue: "unlinked",
      }),
      outlookAppointment("event-3", {
        date: "2026-07-11",
        start: "12:00",
        end: "13:00",
        outlookIssue: "closed-day",
      }),
      outlookAppointment("event-4", {
        isAllDay: true,
        outlookIssue: "all-day",
      }),
    ];
    const data: DispatchDashboardData = {
      appointments,
      healthItems: [],
      requests: [],
      selectedDateLabel: "Wednesday 8 July 2026",
      selectedRequestId: "",
      technicians: [technician],
      timezone: "Australia/Melbourne",
    };
    const counts = Object.fromEntries(
      buildDispatchHealthItems(data).map((item) => [item.key, item.count]),
    );

    expect(counts).toMatchObject({
      "all-day-events": 1,
      "closed-day": 1,
      "double-booked": 1,
      "out-of-hours": 0,
      "unlinked-outlook": 1,
    });
  });
});

function outlookAppointment(
  id: string,
  overrides: Partial<Appointment> = {},
): Appointment {
  return {
    calendarOwnerEmail: "simeon@egit.com.au",
    customer: "Internal EGIT",
    date: "2026-07-08",
    end: "10:00",
    id,
    outlookEventId: id,
    source: "outlook",
    start: "09:00",
    status: "busy",
    technicianId: "tech-simeon",
    title: "Outlook event",
    ...overrides,
  };
}
