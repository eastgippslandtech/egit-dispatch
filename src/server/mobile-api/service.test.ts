import { beforeEach, describe, expect, it, vi } from "vitest";

import { listDispatchTestSyncEvents } from "@/server/dispatch/test-sync";
import {
  completeMobileJob,
  listMobileJobs,
  getMobileJob,
  rileyMobileAuth,
  saveMobileWorklog,
  startMobileTimer,
  stopMobileTimer,
} from "./service";
import type { DatabaseJobRow, DatabaseStaffRow, MobileDatabase } from "./database";

vi.mock("@/server/dispatch/test-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/dispatch/test-sync")>();

  return {
    ...actual,
    listDispatchTestSyncEvents: vi.fn(),
  };
});

const listDispatchTestSyncEventsMock = vi.mocked(listDispatchTestSyncEvents);

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

const dbJob: DatabaseJobRow = {
  createdAt: "2026-07-14T00:00:00.000Z",
  id: "link-100900",
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
        resourceVersion: "db-link-100900-log-mobile-note-1",
      };
    },
    ...overrides,
  };
}

describe("mobile API service", () => {
  beforeEach(() => {
    listDispatchTestSyncEventsMock.mockResolvedValue([]);
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
      id: "link-100900",
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

  it("returns a single real database job with latest notes and request description", async () => {
    const response = await getMobileJob({
      auth: rileyMobileAuth,
      database: createDatabase(),
      jobId: "link-100900",
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

  it("stores native app worklog summaries in the Command Centre database", async () => {
    const saved = vi.fn(async () => ({
      recordedAt: "2026-07-14T02:00:00.000Z",
      resourceId: "log-mobile-note-1",
      resourceVersion: "db-link-100900-log-mobile-note-1",
    }));

    const response = await saveMobileWorklog({
      auth: rileyMobileAuth,
      command: {
        baseVersion: "db-link-100900-2026-07-14T01:20:00.000Z",
        clientMutationId: "note-1",
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
      jobId: "link-100900",
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

  it("records native save-and-complete as a Command Centre completion sync intent", async () => {
    const saved = vi.fn(async () => ({
      recordedAt: "2026-07-14T02:05:00.000Z",
      resourceId: "log-mobile-complete-1",
      resourceVersion: "db-link-100900-log-mobile-complete-1",
    }));

    const response = await completeMobileJob({
      auth: rileyMobileAuth,
      command: {
        baseVersion: "db-link-100900-2026-07-14T01:20:00.000Z",
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
      jobId: "link-100900",
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
    const started = await startMobileTimer({
      auth: rileyMobileAuth,
      command: {
        baseVersion: "db-link-100900-2026-07-14T01:20:00.000Z",
        clientMutationId: "timer-start-1",
        installationId: "phone-1",
        jobId: "link-100900",
        occurredAt: "2026-07-14T01:30:00.000Z",
      },
      database: createDatabase(),
      jobId: "link-100900",
    });

    expect(started.timer).toMatchObject({
      id: "timer-timer-start-1",
      jobId: "link-100900",
      startedAt: "2026-07-14T01:30:00.000Z",
      technicianId: "staff-db-riley",
    });

    const stopped = await stopMobileTimer({
      auth: rileyMobileAuth,
      command: {
        baseVersion: "db-link-100900-2026-07-14T01:20:00.000Z",
        clientMutationId: "timer-stop-1",
        installationId: "phone-1",
        jobId: "link-100900",
        occurredAt: "2026-07-14T01:47:00.000Z",
        startedAt: "2026-07-14T01:30:00.000Z",
        timerId: "timer-timer-start-1",
      },
      database: createDatabase(),
      jobId: "link-100900",
    });

    expect(stopped.timer).toMatchObject({
      actualElapsedMinutes: 17,
      id: "timer-timer-start-1",
      jobId: "link-100900",
      roundedMinutes: 30,
      stoppedAt: "2026-07-14T01:47:00.000Z",
      technicianId: "staff-db-riley",
    });
  });
});
