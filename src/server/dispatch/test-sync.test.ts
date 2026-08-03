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

  it("round trips a lead and two crew as distinct appointments", () => {
    const leadTravel = travelEstimate("Sale", 25);
    const jervyTravel = travelEstimate("Bairnsdale", 10);
    const rileyTravel = travelEstimate("Bairnsdale", 15);
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      scheduleEvent("booking-1", "matt", "10:00", "11:00", leadTravel),
      scheduleEvent(
        "booking-1-crew-jervy",
        "jervy",
        "10:00",
        "11:00",
        jervyTravel,
      ),
      scheduleEvent(
        "booking-1-crew-riley",
        "riley",
        "10:00",
        "11:00",
        rileyTravel,
      ),
    ]);

    expect(
      dashboard.appointments
        .filter((appointment) => appointment.requestId === "req-1")
        .map((appointment) => ({
          bookingType: appointment.bookingType,
          id: appointment.id,
          technicianId: appointment.technicianId,
          travelToSiteMinutes: appointment.travelToSiteMinutes,
        })),
    ).toEqual([
      {
        bookingType: "Onsite",
        id: "booking-1",
        technicianId: "matt",
        travelToSiteMinutes: 25,
      },
      {
        bookingType: "Onsite",
        id: "booking-1-crew-jervy",
        technicianId: "jervy",
        travelToSiteMinutes: 10,
      },
      {
        bookingType: "Onsite",
        id: "booking-1-crew-riley",
        technicianId: "riley",
        travelToSiteMinutes: 15,
      },
    ]);
    expect(dashboard.requests[0].technicianId).toBe("matt");
  });

  it("updates persisted lead and crew once using roster Outlook identity", () => {
    const roster = {
      assignments: [
        {
          appointmentId: "group-a",
          outlookEventId: "event-lead",
          role: "lead" as const,
          technicianId: "matt",
        },
        {
          appointmentId: "group-a-crew-jervy",
          outlookEventId: "event-crew-jervy",
          role: "crew" as const,
          technicianId: "jervy",
        },
      ],
      groupId: "group-a",
    };
    const dashboard = applyDispatchTestSyncEvents(
      {
        ...baseDashboard,
        appointments: [
          persistedAssignment("group-a", "group-a", "matt", "event-lead"),
          persistedAssignment(
            "crew-row-jervy",
            "group-a",
            "jervy",
            "event-crew-jervy",
            "crew",
          ),
        ],
      },
      [
        retainedRescheduleEvent({
          appointmentId: "group-a",
          role: "lead",
          roster,
          technicianId: "matt",
          travel: travelEstimate("Sale", 25),
        }),
        retainedRescheduleEvent({
          appointmentId: "group-a-crew-jervy",
          role: "crew",
          roster,
          technicianId: "jervy",
          travel: travelEstimate("Bairnsdale", 10),
        }),
      ],
    );

    expect(dashboard.appointments).toHaveLength(2);
    expect(dashboard.appointments).toEqual([
      expect.objectContaining({
        bookingType: "Onsite",
        id: "group-a",
        start: "11:00",
        technicianId: "matt",
        travelToSiteMinutes: 25,
      }),
      expect.objectContaining({
        bookingType: "Onsite",
        id: "crew-row-jervy",
        start: "11:00",
        technicianId: "jervy",
        travelToSiteMinutes: 10,
      }),
    ]);
  });

  it("matches multiple no-ID crew by group technician and role only", () => {
    const roster = {
      assignments: [
        {
          appointmentId: "group-a",
          role: "lead" as const,
          technicianId: "matt",
        },
        {
          appointmentId: "group-a-crew-jervy",
          role: "crew" as const,
          technicianId: "jervy",
        },
        {
          appointmentId: "group-a-crew-riley",
          role: "crew" as const,
          technicianId: "riley",
        },
      ],
      groupId: "group-a",
    };
    const dashboard = applyDispatchTestSyncEvents(
      {
        ...baseDashboard,
        appointments: [
          persistedAssignment("group-a", "group-a", "matt"),
          persistedAssignment(
            "crew-row-jervy",
            "group-a",
            "jervy",
            undefined,
            "crew",
          ),
          persistedAssignment(
            "crew-row-riley",
            "group-a",
            "riley",
            undefined,
            "crew",
          ),
          persistedAssignment(
            "stale-jervy-lead",
            "group-a",
            "jervy",
            undefined,
            "lead",
          ),
          persistedAssignment("group-b", "group-b", "jervy"),
        ],
      },
      [
        retainedRescheduleEvent({
          appointmentId: "group-a",
          role: "lead",
          roster,
          technicianId: "matt",
          travel: travelEstimate("Sale", 25),
        }),
        retainedRescheduleEvent({
          appointmentId: "group-a-crew-jervy",
          role: "crew",
          roster,
          technicianId: "jervy",
          travel: travelEstimate("Bairnsdale", 10),
        }),
        retainedRescheduleEvent({
          appointmentId: "group-a-crew-riley",
          role: "crew",
          roster,
          technicianId: "riley",
          travel: travelEstimate("Bairnsdale", 15),
        }),
      ],
    );

    expect(dashboard.appointments.map((appointment) => appointment.id)).toEqual([
      "group-a",
      "crew-row-jervy",
      "crew-row-riley",
      "group-b",
    ]);
    expect(
      dashboard.appointments.filter(
        (appointment) => appointment.scheduleGroupId === "group-a",
      ),
    ).toEqual([
      expect.objectContaining({
        technicianId: "matt",
        travelToSiteMinutes: 25,
      }),
      expect.objectContaining({
        technicianId: "jervy",
        travelToSiteMinutes: 10,
      }),
      expect.objectContaining({
        technicianId: "riley",
        travelToSiteMinutes: 15,
      }),
    ]);
    expect(dashboard.appointments.at(-1)).toMatchObject({
      id: "group-b",
      requestId: "req-1",
      start: "09:00",
    });
  });

  it("does not collapse separate time slots for the same request", () => {
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      scheduleEvent("booking-morning", "matt", "09:00", "10:00"),
      scheduleEvent("booking-afternoon", "matt", "14:00", "15:00"),
    ]);

    expect(
      dashboard.appointments
        .filter((appointment) => appointment.requestId === "req-1")
        .map((appointment) => ({
          id: appointment.id,
          start: appointment.start,
        })),
    ).toEqual([
      { id: "booking-morning", start: "09:00" },
      { id: "booking-afternoon", start: "14:00" },
    ]);
  });

  it.each(["pending", "retrying", "review_required"] as const)(
    "hides obsolete base crew while the lead-only roster is %s",
    (status) => {
      const dashboard = applyDispatchTestSyncEvents(
        {
          ...baseDashboard,
          appointments: [
            persistedAssignment("group-a", "group-a", "matt", "event-lead"),
            persistedAssignment(
              "crew-row-jervy",
              "group-a",
              "jervy",
              "event-crew-jervy",
              "crew",
            ),
            persistedAssignment(
              "stale-lead-row",
              "group-a",
              "matt",
              "event-old-lead",
              "crew",
            ),
            persistedAssignment(
              "group-b",
              "group-b",
              "jervy",
              "event-unrelated",
            ),
          ],
        },
        [
          normaliseDispatchTestSyncEvent({
            appointmentId: "group-a",
            bookingType: "Onsite",
            createdAt: "2026-07-08T02:00:00.000Z",
            date: "2026-07-08",
            end: "12:00",
            eventType: "rescheduled",
            payload: {
              liveSync: { status },
              scheduleAssignment: {
                assignmentKey: "group-a:matt",
                groupId: "group-a",
                role: "lead",
              },
              scheduleRoster: {
                assignments: [
                  {
                    appointmentId: "group-a",
                    outlookEventId: "event-lead",
                    technicianId: "matt",
                  },
                ],
                groupId: "group-a",
              },
              travel: travelEstimate("Sale", 25),
            },
            requestId: "req-1",
            start: "11:00",
            technicianId: "matt",
          }),
        ],
      );

      expect(
        dashboard.appointments.map((appointment) => appointment.id),
      ).toEqual(["group-a", "group-b"]);
      expect(
        dashboard.appointments.find(
          (appointment) => appointment.id === "group-a",
        ),
      ).toMatchObject({
        bookingType: "Onsite",
        end: "12:00",
        start: "11:00",
        travelBackToOfficeMinutes: 25,
        travelToSiteMinutes: 25,
      });
      expect(
        dashboard.appointments.find(
          (appointment) => appointment.id === "group-b",
        ),
      ).toMatchObject({
        outlookEventId: "event-unrelated",
        requestId: "req-1",
        scheduleGroupId: "group-b",
      });
    },
  );

  it("keeps a live scheduled booking visible and flags background sync failures", () => {
    const dashboard = applyDispatchTestSyncEvents(baseDashboard, [
      normaliseDispatchTestSyncEvent({
        appointmentId: "appt-live",
        createdAt: "2026-07-08T00:00:00.000Z",
        date: "2026-07-08",
        end: "10:30",
        eventType: "scheduled",
        payload: {
          liveSync: {
            error: "MSP Central status update failed",
            status: "failed",
          },
        },
        requestId: "req-1",
        start: "09:30",
        technicianId: "matt",
      }),
    ]);

    expect(dashboard.requests[0]).toMatchObject({
      scheduledStart: "2026-07-08T09:30:00+10:00",
      status: "Scheduled",
    });
    expect(dashboard.requests[0].warnings).toContain(
      "Live sync failed: MSP Central status update failed",
    );
    expect(
      dashboard.appointments.find((appointment) => appointment.requestId === "req-1"),
    ).toMatchObject({
      syncIssue: "time-mismatch",
    });
  });

  it("reconciles a Command Centre booking with its returning Outlook event", () => {
    const dashboard = applyDispatchTestSyncEvents(
      {
        ...baseDashboard,
        appointments: [
          ...baseDashboard.appointments,
          {
            id: "outlook-matt-event-1",
            requestId: "676800",
            technicianId: "matt",
            title: "6768000001419914 Printer offline",
            customer: "OneHarvest",
            date: "2026-07-08",
            start: "09:30",
            end: "10:30",
            status: "busy",
            source: "outlook",
            outlookEventId: "event-1",
            readOnly: true,
          },
        ],
      },
      [
        normaliseDispatchTestSyncEvent({
          appointmentId: "pending-live-req-1",
          createdAt: "2026-07-08T00:00:00.000Z",
          date: "2026-07-08",
          end: "10:30",
          eventType: "scheduled",
          payload: {
            liveSync: {
              outlookEventId: "event-1",
              status: "synced",
            },
            scheduleAssignment: {
              assignmentKey: "pending-live-req-1:matt",
              groupId: "pending-live-req-1",
              role: "lead",
            },
          },
          requestId: "req-1",
          start: "09:30",
          technicianId: "matt",
        }),
      ],
    );

    expect(dashboard.appointments).toHaveLength(2);
    expect(
      dashboard.appointments.find(
        (appointment) => appointment.outlookEventId === "event-1",
      ),
    ).toMatchObject({
      id: "outlook-matt-event-1",
      requestId: "req-1",
      readOnly: false,
      scheduleAssignmentRole: "lead",
      scheduleGroupId: "pending-live-req-1",
      source: "linked",
    });
  });

  it("uses Outlook event and technician identity when event IDs repeat across calendars", () => {
    const dashboard = applyDispatchTestSyncEvents(
      {
        ...baseDashboard,
        appointments: [
          {
            ...baseDashboard.appointments[0],
            id: "outlook-matt-shared",
            outlookEventId: "shared-event-id",
            technicianId: "matt",
          },
          {
            ...baseDashboard.appointments[0],
            id: "outlook-jervy-shared",
            outlookEventId: "shared-event-id",
            technicianId: "jervy",
          },
        ],
      },
      [
        normaliseDispatchTestSyncEvent({
          createdAt: "2026-07-08T00:00:00.000Z",
          date: "2026-07-08",
          end: "12:00",
          eventType: "rescheduled",
          payload: {
            liveSync: {
              outlookEventId: "shared-event-id",
              status: "synced",
            },
          },
          requestId: "req-1",
          start: "11:00",
          technicianId: "jervy",
        }),
      ],
    );

    expect(
      dashboard.appointments.find(
        (appointment) => appointment.id === "outlook-matt-shared",
      ),
    ).toMatchObject({ requestId: "req-2", start: "10:00" });
    expect(
      dashboard.appointments.find(
        (appointment) => appointment.id === "outlook-jervy-shared",
      ),
    ).toMatchObject({ requestId: "req-1", start: "11:00" });
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
      updateInfo: {
        at: "2026-07-08T01:00:00.000Z",
        detail: "Reset remote print service and confirmed test label.",
        source: "test-sync",
        summary: "Work Log added",
      },
    });
    expect(dashboard.requests[0].warnings).toContain("Work Log added");
  });
});

function scheduleEvent(
  appointmentId: string,
  technicianId: string,
  start: string,
  end: string,
  travel = travelEstimate("Bairnsdale", 0),
) {
  const groupId = appointmentId.includes("-crew-")
    ? appointmentId.slice(0, appointmentId.indexOf("-crew-"))
    : appointmentId;
  return normaliseDispatchTestSyncEvent({
    appointmentId,
    bookingType: "Onsite",
    createdAt: `2026-07-08T${start}:00.000Z`,
    date: "2026-07-08",
    end,
    eventType: "scheduled",
    payload: {
      scheduleAssignment: {
        assignmentKey: `${groupId}:${technicianId}`,
        groupId,
        role: appointmentId.includes("-crew-") ? "crew" : "lead",
      },
      travel,
    },
    requestId: "req-1",
    start,
    technicianId,
  });
}

function travelEstimate(
  officeOriginName: "Bairnsdale" | "Sale",
  minutes: number,
) {
  const officeOriginId = officeOriginName.toLowerCase() as
    | "bairnsdale"
    | "sale";
  return {
    officeOriginAddress:
      officeOriginId === "sale"
        ? "387 Raymond Street, Sale VIC 3850"
        : "137 Main Street, Bairnsdale VIC 3875",
    officeOriginId,
    officeOriginName,
    travelBackToOfficeMinutes: minutes,
    travelCalculatedFrom: "technician_base_office" as const,
    travelCalculationReason: "Estimated from technician base office",
    travelEstimated: false,
    travelMode: "office_to_site_and_back" as const,
    travelToSiteMinutes: minutes,
  };
}

function retainedRescheduleEvent({
  appointmentId,
  role,
  roster,
  technicianId,
  travel,
}: {
  appointmentId: string;
  role: "crew" | "lead";
  roster: {
    assignments: Array<{
      appointmentId: string;
      outlookEventId?: string;
      role: "crew" | "lead";
      technicianId: string;
    }>;
    groupId: string;
  };
  technicianId: string;
  travel: ReturnType<typeof travelEstimate>;
}) {
  const createdAtMinute =
    technicianId === "matt" ? "00" : technicianId === "jervy" ? "01" : "02";
  return normaliseDispatchTestSyncEvent({
    appointmentId,
    bookingType: "Onsite",
    createdAt: `2026-07-08T02:${createdAtMinute}:00.000Z`,
    date: "2026-07-08",
    end: "12:00",
    eventType: "rescheduled",
    payload: {
      liveSync: { status: "pending" },
      scheduleAssignment: {
        assignmentKey: `group-a:${technicianId}`,
        groupId: "group-a",
        role,
      },
      scheduleRoster: roster,
      travel,
    },
    requestId: "req-1",
    start: "11:00",
    technicianId,
  });
}

function persistedAssignment(
  id: string,
  scheduleGroupId: string,
  technicianId: string,
  outlookEventId?: string,
  scheduleAssignmentRole: "crew" | "lead" = "lead",
) {
  return {
    bookingType: "Remote" as const,
    customer: "OneHarvest",
    date: "2026-07-08",
    end: "10:00",
    id,
    outlookEventId,
    requestId: "req-1",
    scheduleAssignmentRole,
    scheduleGroupId,
    source: "linked" as const,
    start: "09:00",
    status: "confirmed" as const,
    technicianId,
    title: "Printer offline",
  };
}
