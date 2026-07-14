import { describe, expect, it, vi } from "vitest";

import {
  listMobileJobs,
  getMobileJob,
  rileyMobileAuth,
  saveMobileWorklog,
} from "./service";
import type { DatabaseJobRow, DatabaseStaffRow, MobileDatabase } from "./database";

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
        installationId: "phone-1",
        occurredAt: "2026-07-14T02:00:00.000Z",
        startedAt: "2026-07-14T01:30:00.000Z",
        summary: "Rebooted router and verified VPN.",
        timerSessionId: null,
        visibility: "external",
      },
      database: createDatabase({ saveWorklog: saved }),
      jobId: "link-100900",
    });

    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Rebooted router and verified VPN.",
        job: dbJob,
        visibility: "external",
      }),
    );
    expect(response.receipt).toMatchObject({
      clientMutationId: "note-1",
      mode: "database",
      resourceId: "log-mobile-note-1",
      status: "pending",
    });
  });
});
