import { describe, expect, it } from "vitest";

import {
  applyDispatchTestSyncEvents,
  normaliseDispatchTestSyncEvent,
} from "./test-sync";
import type { DispatchDashboardData } from "./types";

const baseDashboard: DispatchDashboardData = {
  selectedDateLabel: "Wednesday 8 July 2026",
  timezone: "Australia/Melbourne",
  technicians: [
    {
      id: "matt",
      displayName: "Matt",
      outlookEmail: "mattd@egit.com.au",
      active: true,
      mappingStatus: "mapped",
      storeLocation: "Sale",
    },
    {
      id: "jervy",
      displayName: "Jervy",
      outlookEmail: "jervy@egit.com.au",
      active: true,
      mappingStatus: "mapped",
      storeLocation: "Bairnsdale",
    },
  ],
  requests: [
    {
      id: "req-1",
      requestNumber: "REQ-1",
      subject: "Printer offline",
      customer: "OneHarvest",
      site: "Packing floor",
      requester: "Mel",
      contact: "mel@example.com",
      priority: "High",
      status: "Ready for Scheduling",
      dueAt: "2026-07-08T00:30:00.000Z",
      ageHours: 3,
      billable: true,
      readyToBook: true,
      slaState: "due-soon",
      warnings: ["Ready to book"],
    },
  ],
  appointments: [
    {
      id: "appt-1",
      requestId: "req-2",
      technicianId: "jervy",
      title: "Existing booking",
      customer: "Internal EGIT",
      date: "2026-07-08",
      start: "10:00",
      end: "11:00",
      status: "confirmed",
      source: "linked",
    },
  ],
  healthItems: [],
  selectedRequestId: "req-1",
};

describe("dispatch test sync overlays", () => {
  it("normalises schedule events from dispatcher payloads", () => {
    expect(
      normaliseDispatchTestSyncEvent({
        eventType: "scheduled",
        requestId: "req-1",
        appointmentId: "appt-test",
        technicianId: "matt",
        date: "2026-07-08",
        start: "09:30",
        end: "10:30",
      }),
    ).toMatchObject({
      eventType: "scheduled",
      requestId: "req-1",
      appointmentId: "appt-test",
      technicianId: "matt",
      date: "2026-07-08",
      start: "09:30",
      end: "10:30",
    });
  });

  it("turns an unscheduled request into a scheduled appointment for mobile", () => {
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        eventType: "scheduled",
        requestId: "req-1",
        appointmentId: "appt-test",
        technicianId: "matt",
        date: "2026-07-08",
        start: "09:30",
        end: "10:30",
        createdAt: "2026-07-08T00:00:00.000Z",
        payload: {
          travel: {
            officeOriginAddress: "387 Raymond Street, Sale VIC 3850",
            officeOriginId: "sale",
            officeOriginName: "Sale",
            travelBackToOfficeMinutes: 70,
            travelCalculatedFrom: "technician_base_office",
            travelCalculationReason: "Estimated from technician base office",
            travelEstimated: false,
            travelMode: "office_to_site_and_back",
            travelToSiteMinutes: 70,
          },
        },
      }),
    ]);

    expect(dashboard.requests[0]).toMatchObject({
      status: "Scheduled",
      technicianId: "matt",
      readyToBook: false,
      scheduledStart: "2026-07-08T09:30:00+10:00",
      scheduledEnd: "2026-07-08T10:30:00+10:00",
    });
    expect(dashboard.appointments).toContainEqual(
      expect.objectContaining({
        id: "appt-test",
        requestId: "req-1",
        technicianId: "matt",
        title: "Printer offline",
        date: "2026-07-08",
        start: "09:30",
        end: "10:30",
        source: "linked",
        travelBackToOfficeMinutes: 70,
        travelToSiteMinutes: 70,
      }),
    );
  });

  it("moves an existing appointment between technicians", () => {
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        eventType: "rescheduled",
        appointmentId: "appt-1",
        technicianId: "matt",
        date: "2026-07-08",
        start: "13:00",
        end: "14:00",
        payload: {
          travel: {
            officeOriginAddress: "137 Main Street, Bairnsdale VIC 3875",
            officeOriginId: "bairnsdale",
            officeOriginName: "Bairnsdale",
            travelBackToOfficeMinutes: 10,
            travelCalculatedFrom: "technician_base_office",
            travelCalculationReason: "Estimated from technician base office",
            travelEstimated: false,
            travelMode: "office_to_site_and_back",
            travelToSiteMinutes: 10,
          },
        },
      }),
    ]);

    expect(dashboard.appointments.find((item) => item.id === "appt-1")).toMatchObject({
      technicianId: "matt",
      start: "13:00",
      end: "14:00",
      travelBackToOfficeMinutes: 10,
      travelToSiteMinutes: 10,
    });
  });

  it("cancels a test-synced appointment without deleting live source data", () => {
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        eventType: "cancelled",
        appointmentId: "appt-1",
      }),
    ]);

    expect(dashboard.appointments.find((item) => item.id === "appt-1")).toMatchObject({
      status: "tentative",
      syncIssue: "time-mismatch",
    });
  });

  it("applies a Work Log event to request notes and completion status", () => {
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        eventType: "work_logged",
        requestId: "req-1",
        createdAt: "2026-07-08T01:00:00.000Z",
        payload: {
          workLog: {
            billable: true,
            minutesSpent: 45,
            notes: "Reset remote print service and confirmed test label.",
            status: "Resolved",
            visibility: "Internal",
            workType: "Remote",
          },
        },
      }),
    ]);

    expect(dashboard.requests[0]).toMatchObject({
      notes:
        "Work Log (45 min, billable, Remote, Internal): Reset remote print service and confirmed test label.",
      status: "Resolved",
    });
    expect(dashboard.requests[0].warnings).toContain("Work Log added");
  });

  it("applies mobile timer start and stop events to the dispatch request", () => {
    const running = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        eventType: "timer_started",
        requestId: "req-1",
        appointmentId: "appt-test",
        technicianId: "matt",
        createdAt: "2026-07-08T01:15:00.000Z",
        payload: {
          timer: {
            id: "timer-mobile-1",
            jobId: "appt-test",
            startedAt: "2026-07-08T01:15:00.000Z",
            technicianId: "matt",
          },
        },
      }),
    ]);

    expect(running.requests[0].activeTimer).toMatchObject({
      id: "timer-mobile-1",
      jobId: "appt-test",
      startedAt: "2026-07-08T01:15:00.000Z",
      technicianId: "matt",
    });
    expect(running.requests[0].warnings).toContain("Active timer");

    const stopped = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        eventType: "timer_started",
        requestId: "req-1",
        appointmentId: "appt-test",
        technicianId: "matt",
        createdAt: "2026-07-08T01:15:00.000Z",
        payload: {
          timer: {
            id: "timer-mobile-1",
            jobId: "appt-test",
            startedAt: "2026-07-08T01:15:00.000Z",
            technicianId: "matt",
          },
        },
      }),
      normaliseDispatchTestSyncEvent({
        eventType: "timer_stopped",
        requestId: "req-1",
        appointmentId: "appt-test",
        technicianId: "matt",
        createdAt: "2026-07-08T01:45:00.000Z",
        payload: {
          timer: {
            id: "timer-mobile-1",
            jobId: "appt-test",
            startedAt: "2026-07-08T01:15:00.000Z",
            stoppedAt: "2026-07-08T01:45:00.000Z",
            technicianId: "matt",
          },
        },
      }),
    ]);

    expect(stopped.requests[0].activeTimer).toBeUndefined();
    expect(stopped.requests[0].warnings).not.toContain("Active timer");
  });
});
