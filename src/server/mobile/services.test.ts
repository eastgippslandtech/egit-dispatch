import { describe, expect, it } from "vitest";

import {
  addPartUsed,
  attachJobEvidence,
  calculateRoundedMinutes,
  completeJob,
  createWorklog,
  getJobActions,
  listAssignableTechnicians,
  listMyJobs,
  listMyWorkload,
  resolveStaffProfileForMobile,
  saveCustomerSignOff,
  saveDraftNote,
  startTimer,
  stopTimer,
  updateStatus,
} from "./services";
import type { MobileJob, WorkNoteDraft } from "./types";

describe("mobile technician services", () => {
  it("maps the signed-in Zoho user to a staff profile", () => {
    const staff = resolveStaffProfileForMobile({
      status: "approved",
      accessLevel: "staff",
      email: "SIMEON@EGIT.COM.AU",
      name: "Simeon",
    });

    expect(staff).toMatchObject({
      id: "staff-simeon",
      zohoEmail: "simeon@egit.com.au",
      dispatchEnabled: true,
    });
  });

  it("filters My Schedule to the signed-in technician", () => {
    const jobs = listMyJobs({
      date: "2026-07-08",
      zohoEmail: "jervy@egit.com.au",
    });

    expect(jobs.map((job) => job.technicianName)).toEqual(["Jervy", "Jervy"]);
    expect(jobs.map((job) => job.title)).toContain("Practice management update");
    expect(jobs.map((job) => job.title)).not.toContain("File server disk expansion");
  });

  it("populates the My Workload sections", () => {
    const workload = listMyWorkload({ zohoEmail: "jervy@egit.com.au" });

    expect(workload.map((section) => section.label)).toEqual([
      "Today",
      "Upcoming",
      "Assigned to me",
      "SLA risk",
      "Waiting on me",
      "Recently completed",
    ]);
    expect(workload.every((section) => section.jobs.length > 0)).toBe(true);
  });

  it("marks Outlook-only jobs read-only and disables Helpdesk actions", () => {
    const [job] = listMyJobs({
      date: "2026-07-08",
      zohoEmail: "jervy@egit.com.au",
    }).filter((candidate) => candidate.readOnlyOutlook);

    expect(job).toBeDefined();
    expect(getJobActions(job)).toMatchObject({
      canAddWorkNote: false,
      canAttachEvidence: false,
      canCaptureCustomerSignOff: false,
      canChangeStatus: false,
      canComplete: false,
      canOpenOutlookEvent: true,
      canTrackParts: false,
      canReassign: false,
      canStartTimer: false,
    });
  });

  it("loads job detail fields without an asset/device view", () => {
    const [job] = listMyJobs({
      date: "2026-07-08",
      zohoEmail: "jervy@egit.com.au",
    });

    expect(job).toMatchObject({
      address: "Sale VIC 3850",
      contactEmail: "sarah.mills@example.com",
      contactName: "Sarah Mills",
      contactPhone: "03 5156 8899",
      customer: "Sale Family Dentist",
      requestNumber: "REQ-100246",
      site: "Consult rooms",
      technicianName: "Jervy",
      title: "Practice management update",
    });
    expect(Object.keys(job)).not.toContain("asset");
    expect(Object.keys(job)).not.toContain("device");
  });

  it("enforces one active timer per technician", () => {
    const active = startTimer({
      activeTimer: undefined,
      at: new Date("2026-07-09T09:00:00+10:00"),
      jobId: "job-1",
      technicianId: "tech-jervy",
    });

    expect(() =>
      startTimer({
        activeTimer: active,
        at: new Date("2026-07-09T09:05:00+10:00"),
        jobId: "job-2",
        technicianId: "tech-jervy",
      }),
    ).toThrow("A timer is already running for this technician.");
  });

  it("starts and stops a timer with actual elapsed minutes", () => {
    const active = startTimer({
      activeTimer: undefined,
      at: new Date("2026-07-09T09:00:00+10:00"),
      jobId: "job-1",
      technicianId: "tech-jervy",
    });
    const stopped = stopTimer({
      activeTimer: active,
      at: new Date("2026-07-09T09:31:00+10:00"),
    });

    expect(stopped).toMatchObject({
      actualElapsedMinutes: 31,
      jobId: "job-1",
      roundedMinutes: 45,
      technicianId: "tech-jervy",
    });
  });

  it.each([
    [1, 15],
    [14, 15],
    [15, 15],
    [16, 30],
    [29, 30],
    [30, 30],
    [31, 45],
  ])("rounds %i minutes up to %i", (actual, rounded) => {
    expect(calculateRoundedMinutes(actual)).toBe(rounded);
  });

  it("accepts all MVP worklog types", () => {
    expect(createWorklog({ worklogType: "billable", workNote: "Done" })).toMatchObject({
      saved: true,
      worklogType: "billable",
    });
    expect(createWorklog({ worklogType: "internal", workNote: "Done" })).toMatchObject({
      saved: true,
      worklogType: "internal",
    });
    expect(
      createWorklog({ worklogType: "non_billable", workNote: "Done" }),
    ).toMatchObject({
      saved: true,
      worklogType: "non_billable",
    });
  });

  it("validates quick notes and preserves failed saves as drafts", () => {
    const draft: WorkNoteDraft = {
      jobId: "job-1",
      noteText: "",
      worklogType: "billable",
    };

    expect(() => saveDraftNote(draft)).toThrow("Work note is required.");

    const failed = saveDraftNote({
      ...draft,
      noteText: "Keep this",
      simulateFailure: true,
    });

    expect(failed).toMatchObject({
      draft: {
        jobId: "job-1",
        noteText: "Keep this",
        worklogType: "billable",
      },
      error: "Note save failed. Draft preserved for retry.",
      saved: false,
    });
  });

  it("requires a note before completing a job with no existing notes", () => {
    const job = {
      id: "job-1",
      previousNotes: [],
      status: "In Progress",
    } as MobileJob;

    expect(() =>
      completeJob({
        billableType: "billable",
        followUpNeeded: false,
        job,
        noteText: "",
      }),
    ).toThrow("A work note is required before completing this job.");
  });

  it("updates status in mock mode", () => {
    const job = { id: "job-1", status: "Scheduled" } as MobileJob;

    expect(updateStatus(job, "Waiting on Parts")).toMatchObject({
      id: "job-1",
      status: "Waiting on Parts",
    });
  });

  it("uses the staff profile list for reassignment choices", () => {
    expect(listAssignableTechnicians().map((staff) => staff.zohoEmail)).toEqual([
      "simeon@egit.com.au",
      "mattd@egit.com.au",
      "jervy@egit.com.au",
      "riley@egit.com.au",
    ]);
  });

  it("creates attachment/photo evidence metadata without uploading files", () => {
    const evidence = attachJobEvidence({
      capturedAt: new Date("2026-07-09T10:00:00+10:00"),
      fileName: "cabinet-before.jpg",
      fileSizeBytes: 1_024_000,
      jobId: "job-1",
      kind: "photo",
      note: "Before tidy",
    });

    expect(evidence).toMatchObject({
      fileName: "cabinet-before.jpg",
      fileSizeBytes: 1_024_000,
      jobId: "job-1",
      kind: "photo",
      note: "Before tidy",
      uploadState: "mock_pending",
    });
    expect(evidence).not.toHaveProperty("file");
    expect(evidence).not.toHaveProperty("content");
  });

  it("requires customer name and consent for sign-off", () => {
    expect(() =>
      saveCustomerSignOff({
        accepted: false,
        customerName: "Alex Client",
        jobId: "job-1",
        signedAt: new Date("2026-07-09T10:15:00+10:00"),
      }),
    ).toThrow("Customer sign-off must be accepted.");

    expect(() =>
      saveCustomerSignOff({
        accepted: true,
        customerName: "",
        jobId: "job-1",
        signedAt: new Date("2026-07-09T10:15:00+10:00"),
      }),
    ).toThrow("Customer name is required for sign-off.");
  });

  it("captures customer sign-off as mock/API-ready data", () => {
    expect(
      saveCustomerSignOff({
        accepted: true,
        customerName: "Alex Client",
        jobId: "job-1",
        signedAt: new Date("2026-07-09T10:15:00+10:00"),
        signatureText: "Alex Client",
      }),
    ).toMatchObject({
      accepted: true,
      customerName: "Alex Client",
      jobId: "job-1",
      signatureText: "Alex Client",
      syncState: "mock_pending",
    });
  });

  it("validates and captures parts used line items", () => {
    expect(() =>
      addPartUsed({
        jobId: "job-1",
        partName: "",
        quantity: 1,
      }),
    ).toThrow("Part name is required.");

    expect(() =>
      addPartUsed({
        jobId: "job-1",
        partName: "Patch lead",
        quantity: 0,
      }),
    ).toThrow("Part quantity must be greater than zero.");

    expect(
      addPartUsed({
        jobId: "job-1",
        partName: "Patch lead",
        quantity: 2,
        sku: "PL-2M-BLUE",
      }),
    ).toMatchObject({
      jobId: "job-1",
      partName: "Patch lead",
      quantity: 2,
      sku: "PL-2M-BLUE",
      syncState: "mock_pending",
    });
  });
});
