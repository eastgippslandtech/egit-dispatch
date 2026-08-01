import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listDispatchTestSyncEvents,
  recordDispatchTestSyncEvent,
} from "@/server/dispatch/test-sync";
import {
  completeMobileJob,
  listMobileJobs,
  getMobileJob,
  registerMobilePushToken,
  rileyMobileAuth,
  saveMobileWorklog,
  startMobileTimer,
  stopMobileTimer,
} from "./service";
import type { DatabaseJobRow, DatabaseStaffRow, MobileDatabase } from "./database";
import type { Appointment } from "@/server/dispatch/types";

vi.mock("@/server/dispatch/test-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/dispatch/test-sync")>();

  return {
    ...actual,
    listDispatchTestSyncEvents: vi.fn(),
    recordDispatchTestSyncEvent: vi.fn(),
  };
});

const listDispatchTestSyncEventsMock = vi.mocked(listDispatchTestSyncEvents);
const recordDispatchTestSyncEventMock = vi.mocked(recordDispatchTestSyncEvent);

const dbStaff: DatabaseStaffRow = {
  active: true,
  baseOffice: "Bairnsdale",
  displayName: "Riley",
  dispatchEnabled: true,
  id: "staff-db-riley",
  mspCentralEmail: "riley@egit.com.au",
  mspCentralTechnicianId: null,
  outlookEmail: "riley@egit.com.au",
  outlookUserPrincipalName: "riley@egit.com.au",
  role: "technician",
  zohoEmail: "riley@egit.com.au",
};

const dbJobId = "00000000-0000-4000-8000-000000100900";

const dbJob: DatabaseJobRow = {
  createdAt: "2026-07-14T00:00:00.000Z",
  id: dbJobId,
  lastSyncError: null,
  lastSyncStatus: "linked",
  notes: [
    {
      action: "ticket_note",
      createdAt: "2026-07-14T01:15:00.000Z",
      id: "log-note-latest",
      message: "Latest ticket note: customer confirmed VPN works.",
      payloadSummary: {
        note: "Customer confirmed VPN works after reboot.",
      },
      status: "success",
    },
    {
      action: "ticket_snapshot",
      createdAt: "2026-07-14T00:30:00.000Z",
      id: "log-snapshot",
      message: "Imported request snapshot.",
      payloadSummary: {
        contactEmail: "alex@example.invalid",
        contactName: "Alex Morgan",
        contactPhone: "+61 400 900 100",
        customerName: "Gippsland Legal",
        description:
          "Real Command Centre database request description for VPN outage.",
        priority: "High",
        requestStatus: "Scheduled",
        siteAddress: "14 Main Street, Bairnsdale VIC 3875",
        siteName: "Bairnsdale Office",
        siteTown: "Bairnsdale",
        subject: "VPN outage follow-up",
      },
      status: "success",
    },
  ],
  outlookCalendarEmail: "riley@egit.com.au",
  outlookEventId: null,
  scheduledEnd: "2026-07-14T11:00:00.000Z",
  scheduledStart: "2026-07-14T10:00:00.000Z",
  sdpRequestId: "100900",
  sdpRequestNumber: "REQ-100900",
  staff: dbStaff,
  technicianId: "staff-db-riley",
  updatedAt: "2026-07-14T01:20:00.000Z",
};

const outlookAppointment: Appointment = {
  bookingType: "Remote",
  bodyPreview: "Weekly Command Centre operations review.",
  calendarOwnerEmail: "riley@egit.com.au",
  customer: "Microsoft Teams Meeting",
  date: "2026-07-14",
  end: "15:00",
  id: "outlook-tech-riley-event-outlook-1",
  outlookEventId: "event-outlook-1",
  outlookWebLink: "https://outlook.office.com/calendar/item/event-outlook-1",
  readOnly: true,
  source: "outlook",
  start: "14:00",
  status: "busy",
  technicianId: "tech-riley",
  title: "Command Centre training",
};

function createOutlookCalendar(
  appointments: Appointment[] = [outlookAppointment],
) {
  return {
    async findAppointment() {
      return appointments[0] ?? null;
    },
    async listAppointments() {
      return appointments;
    },
  };
}

function createDatabase(overrides: Partial<MobileDatabase> = {}): MobileDatabase {
  return {
    async findStaffByZohoEmail() {
      return dbStaff;
    },
    async findJobForStaff() {
      return dbJob;
    },
    async listJobsForStaff() {
      return [dbJob];
    },
    async saveWorklog() {
      return {
        recordedAt: "2026-07-14T02:00:00.000Z",
        resourceId: "log-mobile-note-1",
        resourceVersion: `db-${dbJobId}-log-mobile-note-1`,
      };
    },
    async saveTimerEvent() {
      return {
        recordedAt: "2026-07-14T01:30:00.000Z",
        resourceId: "timer-log-1",
        resourceVersion: `db-${dbJobId}-timer-log-1`,
      };
    },
    ...overrides,
  };
}

describe("mobile API service", () => {
  beforeEach(() => {
    listDispatchTestSyncEventsMock.mockResolvedValue([]);
    recordDispatchTestSyncEventMock.mockReset();
  });

  it("returns only jobs for the authenticated staff profile", async () => {
    const response = await listMobileJobs({
      auth: rileyMobileAuth,
      from: "2026-07-09",
      to: "2026-07-09",
    });

    expect(
      response.jobs.every((job) => job.technician.email === "riley@egit.com.au"),
    ).toBe(true);
  });

  it("stores the Expo push token against the authenticated technician", async () => {
    const registerDevice = vi.fn(async () => undefined);

    await registerMobilePushToken({
      appVersion: "1.0.0",
      auth: rileyMobileAuth,
      installationId: "riley-iphone",
      platform: "ios",
      pushToken: "ExponentPushToken[riley]",
      repository: { registerDevice },
    });

    expect(registerDevice).toHaveBeenCalledWith({
      appVersion: "1.0.0",
      installationId: "riley-iphone",
      platform: "ios",
      pushToken: "ExponentPushToken[riley]",
      staffEmail: "riley@egit.com.au",
    });
  });

  it("rejects a write to an Outlook-only event", async () => {
    await expect(
      saveMobileWorklog({
        auth: rileyMobileAuth,
        command: {
          baseVersion: "version-riley-outlook-1",
          body: "Done",
          clientMutationId: "note-1",
          installationId: "inst-1",
          visibility: "internal",
        },
        jobId: "outlook-block-riley",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lists real Command Centre database jobs for the authenticated technician", async () => {
    const response = await listMobileJobs({
      auth: rileyMobileAuth,
      database: createDatabase(),
      from: "2026-07-14",
      to: "2026-07-14",
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]).toMatchObject({
      customerName: "Gippsland Legal",
      description:
        "Real Command Centre database request description for VPN outage.",
      id: dbJobId,
      requestNumber: "REQ-100900",
      source: "msp_central",
      title: "VPN outage follow-up",
    });
    expect(response.jobs[0].previousNotes.map((note) => note.body)).toEqual([
      "Customer confirmed VPN works after reboot.",
      "Imported request snapshot.",
    ]);
    expect(response.jobs[0].technician.email).toBe("riley@egit.com.au");
  });

  it("adds Outlook-only calendar bookings to the technician schedule", async () => {
    const response = await listMobileJobs({
      auth: rileyMobileAuth,
      database: createDatabase({
        async listJobsForStaff() {
          return [];
        },
      }),
      from: "2026-07-14",
      outlookCalendar: createOutlookCalendar(),
      to: "2026-07-14",
    });

    expect(response.jobs).toContainEqual(
      expect.objectContaining({
        bookingType: "Remote",
        id: "outlook-tech-riley-event-outlook-1",
        outlookEventId: "event-outlook-1",
        source: "outlook",
        title: "Command Centre training",
        technician: expect.objectContaining({
          email: "riley@egit.com.au",
        }),
        permissions: expect.objectContaining({
          canStartTimer: false,
          canWriteWorklog: false,
        }),
      }),
    );
  });

  it("uses real Outlook bookings instead of samples when the database is unavailable", async () => {
    const response = await listMobileJobs({
      auth: rileyMobileAuth,
      database: null,
      from: "2026-07-14",
      outlookCalendar: createOutlookCalendar(),
      to: "2026-07-14",
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]).toMatchObject({
      id: "outlook-tech-riley-event-outlook-1",
      source: "outlook",
      title: "Command Centre training",
    });
  });

  it("does not duplicate an Outlook event already linked to a Command Centre job", async () => {
    const response = await listMobileJobs({
      auth: rileyMobileAuth,
      database: createDatabase({
        async listJobsForStaff() {
          return [{ ...dbJob, outlookEventId: "event-outlook-1" }];
        },
      }),
      from: "2026-07-14",
      outlookCalendar: createOutlookCalendar(),
      to: "2026-07-14",
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]).toMatchObject({
      id: dbJobId,
      outlookEventId: "event-outlook-1",
      source: "msp_central",
    });
  });

  it("adds dispatcher test-sync schedules to the technician mobile job list", async () => {
    listDispatchTestSyncEventsMock.mockResolvedValueOnce([
      {
        appointmentId: "mock-100284-test",
        bookingType: "Onsite",
        createdAt: "2026-07-14T01:00:00.000Z",
        date: "2026-07-14",
        end: "14:00",
        eventType: "scheduled",
        id: "event-100284",
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
        priority: "Critical",
        requestId: "100284",
        start: "12:45",
        technicianId: "tech-riley",
      },
    ]);

    const response = await listMobileJobs({
      auth: rileyMobileAuth,
      database: createDatabase({
        async listJobsForStaff() {
          return [];
        },
      }),
      from: "2026-07-14",
      to: "2026-07-14",
    });

    expect(response.jobs).toContainEqual(
      expect.objectContaining({
        id: "mock-100284-test",
        priority: "Critical",
        requestNumber: "REQ-100284",
        source: "mock",
        technician: expect.objectContaining({
          email: "riley@egit.com.au",
        }),
        title: "Packhouse label printer offline",
        travel: expect.objectContaining({
          travelBackToOfficeMinutes: 10,
          travelToSiteMinutes: 10,
        }),
      }),
    );
  });

  it("starts timers for dispatcher test-sync jobs when the database is configured", async () => {
    listDispatchTestSyncEventsMock.mockResolvedValueOnce([
      {
        appointmentId: "mock-100284-test",
        bookingType: "Onsite",
        createdAt: "2026-07-14T01:00:00.000Z",
        date: "2026-07-14",
        end: "14:00",
        eventType: "scheduled",
        id: "event-100284",
        payload: {},
        priority: "Critical",
        requestId: "100284",
        start: "12:45",
        technicianId: "tech-riley",
      },
    ]);

    const started = await startMobileTimer({
      auth: rileyMobileAuth,
      command: {
        baseVersion:
          "test-sync-mock-100284-test-2026-07-14-12:45-14:00",
        clientMutationId: "timer-start-test-sync-1",
        installationId: "phone-1",
        jobId: "mock-100284-test",
        occurredAt: "2026-07-14T02:30:00.000Z",
      },
      database: createDatabase({
        async findJobForStaff() {
          return null;
        },
      }),
      jobId: "mock-100284-test",
    });

    expect(started.timer).toMatchObject({
      id: "timer-timer-start-test-sync-1",
      jobId: "mock-100284-test",
      startedAt: "2026-07-14T02:30:00.000Z",
      technicianId: "tech-riley",
    });
    expect(recordDispatchTestSyncEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "mock-100284-test",
        eventType: "timer_started",
        requestId: "100284",
        technicianId: "tech-riley",
        payload: {
          timer: expect.objectContaining({
            id: "timer-timer-start-test-sync-1",
            startedAt: "2026-07-14T02:30:00.000Z",
          }),
        },
      }),
      "riley@egit.com.au",
    );
  });

  it("does not run a UUID database lookup before starting a test-sync timer", async () => {
    listDispatchTestSyncEventsMock.mockResolvedValueOnce([
      {
        appointmentId: "mock-100284-test",
        bookingType: "Onsite",
        createdAt: "2026-07-14T01:00:00.000Z",
        date: "2026-07-14",
        end: "14:00",
        eventType: "scheduled",
        id: "event-100284",
        payload: {},
        priority: "Critical",
        requestId: "100284",
        start: "12:45",
        technicianId: "tech-riley",
      },
    ]);
    const findJobForStaff = vi.fn(async () => {
      throw new Error("invalid input syntax for type uuid: mock-100284-test");
    });

    await expect(
      startMobileTimer({
        auth: rileyMobileAuth,
        command: {
          baseVersion:
            "test-sync-mock-100284-test-2026-07-14-12:45-14:00",
          clientMutationId: "timer-start-test-sync-uuid-guard",
          installationId: "phone-1",
          jobId: "mock-100284-test",
          occurredAt: "2026-07-14T02:30:00.000Z",
        },
        database: createDatabase({ findJobForStaff }),
        jobId: "mock-100284-test",
      }),
    ).resolves.toMatchObject({
      timer: {
        id: "timer-timer-start-test-sync-uuid-guard",
        jobId: "mock-100284-test",
        technicianId: "tech-riley",
      },
    });
    expect(findJobForStaff).not.toHaveBeenCalled();
  });

  it("returns a single real database job with latest notes and request description", async () => {
    const response = await getMobileJob({
      auth: rileyMobileAuth,
      database: createDatabase(),
      jobId: dbJobId,
    });

    expect(response.job.description).toBe(
      "Real Command Centre database request description for VPN outage.",
    );
    expect(response.job.previousNotes[0]).toMatchObject({
      authorName: "Command Centre",
      body: "Customer confirmed VPN works after reboot.",
      visibility: "external",
    });
  });

  it("returns an Outlook-only booking detail as read-only", async () => {
    const response = await getMobileJob({
      auth: rileyMobileAuth,
      database: createDatabase({
        async findJobForStaff() {
          return null;
        },
      }),
      jobId: "outlook-tech-riley-event-outlook-1",
      outlookCalendar: createOutlookCalendar(),
    });

    expect(response.job).toMatchObject({
      id: "outlook-tech-riley-event-outlook-1",
      source: "outlook",
      title: "Command Centre training",
      permissions: {
        canAddPart: false,
        canAttachEvidence: false,
        canComplete: false,
        canSignOff: false,
        canStartTimer: false,
        canUpdateStatus: false,
        canWriteWorklog: false,
        readOnlyReason: "Outlook calendar events are read-only.",
      },
    });
  });

  it("opens an Outlook-only booking when the database is unavailable", async () => {
    const response = await getMobileJob({
      auth: rileyMobileAuth,
      database: null,
      jobId: "outlook-tech-riley-event-outlook-1",
      outlookCalendar: createOutlookCalendar(),
    });

    expect(response.job).toMatchObject({
      id: "outlook-tech-riley-event-outlook-1",
      source: "outlook",
      title: "Command Centre training",
    });
  });

  it("stores native app worklog summaries in the Command Centre database", async () => {
    const saved = vi.fn(async () => ({
      recordedAt: "2026-07-14T02:00:00.000Z",
      resourceId: "log-mobile-note-1",
      resourceVersion: `db-${dbJobId}-log-mobile-note-1`,
    }));

    const response = await saveMobileWorklog({
      auth: rileyMobileAuth,
      command: {
        baseVersion: `db-${dbJobId}-2026-07-14T01:20:00.000Z`,
        clientMutationId: "note-1",
        disposition: "return_to_queue",
        durationMinutes: 30,
        endedAt: "2026-07-14T02:00:00.000Z",
        billable: true,
        installationId: "phone-1",
        occurredAt: "2026-07-14T02:00:00.000Z",
        startedAt: "2026-07-14T01:30:00.000Z",
        summary: "Rebooted router and verified VPN.",
        timerSessionId: null,
        visibility: "external",
        workType: "billable",
      },
      database: createDatabase({ saveWorklog: saved }),
      jobId: dbJobId,
    });

    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Rebooted router and verified VPN.",
        billable: true,
        job: dbJob,
        visibility: "external",
        workType: "billable",
      }),
    );
    expect(response.receipt).toMatchObject({
      clientMutationId: "note-1",
      mode: "database",
      resourceId: "log-mobile-note-1",
      status: "pending",
    });
  });

  it("rejects a scheduled mobile Work Log without an outcome as bad input", async () => {
    await expect(
      saveMobileWorklog({
        auth: rileyMobileAuth,
        command: {
          baseVersion: "db-link-100900-2026-07-14T01:20:00.000Z",
          clientMutationId: "note-missing-outcome",
          durationMinutes: 30,
          endedAt: "2026-07-14T02:00:00.000Z",
          installationId: "phone-1",
          occurredAt: "2026-07-14T02:00:00.000Z",
          startedAt: "2026-07-14T01:30:00.000Z",
          summary: "Checked the service.",
          visibility: "external",
        },
        database: createDatabase(),
        jobId: "link-100900",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("records native save-and-complete as a Command Centre completion sync intent", async () => {
    const saved = vi.fn(async () => ({
      recordedAt: "2026-07-14T02:05:00.000Z",
      resourceId: "log-mobile-complete-1",
      resourceVersion: `db-${dbJobId}-log-mobile-complete-1`,
    }));

    const response = await completeMobileJob({
      auth: rileyMobileAuth,
      command: {
        baseVersion: `db-${dbJobId}-2026-07-14T01:20:00.000Z`,
        billable: false,
        clientMutationId: "complete-1",
        durationMinutes: 45,
        followUpNeeded: false,
        installationId: "phone-1",
        occurredAt: "2026-07-14T02:05:00.000Z",
        summary: "Completed VPN follow-up and confirmed with Alex.",
        visibility: "external",
        workType: "non_billable",
      },
      database: createDatabase({ saveWorklog: saved }),
      jobId: dbJobId,
    });

    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mobile_completion",
        billable: false,
        body: "Completed VPN follow-up and confirmed with Alex.",
        durationMinutes: 45,
        followUpNeeded: false,
        job: dbJob,
        targetStatus: "Resolved",
        visibility: "external",
        workType: "non_billable",
      }),
    );
    expect(response.receipt).toMatchObject({
      clientMutationId: "complete-1",
      mode: "database",
      resourceId: "log-mobile-complete-1",
      status: "pending",
    });
  });

  it("starts and stops native timers for real database jobs", async () => {
    const saveTimerEvent = vi.fn(async () => ({
      recordedAt: "2026-07-14T01:30:00.000Z",
      resourceId: "timer-log-1",
      resourceVersion: `db-${dbJobId}-timer-log-1`,
    }));
    const started = await startMobileTimer({
      auth: rileyMobileAuth,
      command: {
        baseVersion: `db-${dbJobId}-2026-07-14T01:20:00.000Z`,
        clientMutationId: "timer-start-1",
        installationId: "phone-1",
        jobId: dbJobId,
        occurredAt: "2026-07-14T01:30:00.000Z",
      },
      database: createDatabase({
        saveTimerEvent,
      } as unknown as Partial<MobileDatabase>),
      jobId: dbJobId,
    });

    expect(started.timer).toMatchObject({
      id: "timer-timer-start-1",
      jobId: dbJobId,
      startedAt: "2026-07-14T01:30:00.000Z",
      technicianId: "staff-db-riley",
    });
    expect(saveTimerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mobile_timer_start",
        clientMutationId: "timer-start-1",
        job: dbJob,
        timer: expect.objectContaining({
          id: "timer-timer-start-1",
          startedAt: "2026-07-14T01:30:00.000Z",
        }),
      }),
    );

    const stopped = await stopMobileTimer({
      auth: rileyMobileAuth,
      command: {
        baseVersion: `db-${dbJobId}-2026-07-14T01:20:00.000Z`,
        clientMutationId: "timer-stop-1",
        installationId: "phone-1",
        jobId: dbJobId,
        occurredAt: "2026-07-14T01:47:00.000Z",
        startedAt: "2026-07-14T01:30:00.000Z",
        timerId: "timer-timer-start-1",
      },
      database: createDatabase({
        saveTimerEvent,
      } as unknown as Partial<MobileDatabase>),
      jobId: dbJobId,
    });

    expect(stopped.timer).toMatchObject({
      actualElapsedMinutes: 17,
      id: "timer-timer-start-1",
      jobId: dbJobId,
      roundedMinutes: 30,
      stoppedAt: "2026-07-14T01:47:00.000Z",
      technicianId: "staff-db-riley",
    });
    expect(saveTimerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mobile_timer_stop",
        clientMutationId: "timer-stop-1",
        job: dbJob,
        timer: expect.objectContaining({
          id: "timer-timer-start-1",
          stoppedAt: "2026-07-14T01:47:00.000Z",
        }),
      }),
    );
  });
});
