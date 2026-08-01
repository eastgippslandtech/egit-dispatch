import { describe, expect, it, vi } from "vitest";

import type { MobileJob } from "../../contracts/mobile";
import { MOBILE_JOB_FIXTURES } from "../../testing/fixtures";

import {
  completeJobLocally,
  createWorklogDraftStore,
  saveWorklogWithDraft,
} from "./worklog-service";

const firewallJob = MOBILE_JOB_FIXTURES.find(
  (job) => job.id === "firewall-riley",
) as MobileJob;
const emptyJob: MobileJob = {
  ...firewallJob,
  id: "empty-job",
  previousNotes: [],
};

describe("worklog service", () => {
  it("preserves an external note draft when submission fails", async () => {
    const drafts = createWorklogDraftStore();
    const result = await saveWorklogWithDraft({
      draftStore: drafts,
      job: firewallJob,
      note: "Replaced failed switch",
      disposition: "return_to_queue",
      idempotencyKey: "worklog-firewall-riley-1",
      simulateFailure: true,
      technicianId: "staff-riley",
      visibility: "external",
    });

    expect(result.status).toBe("queued-for-retry");
    expect(await drafts.get("staff-riley", "firewall-riley")).toMatchObject({
      note: "Replaced failed switch",
      visibility: "external",
    });
  });

  it("sends visibility, time, billable flag and work type with saved work logs", async () => {
    const drafts = createWorklogDraftStore();
    const submitted = vi.fn(async () => ({
      clientMutationId: "receipt-1",
      mode: "database" as const,
      resourceId: "worklog-1",
      resourceVersion: "version-1",
      status: "pending" as const,
      recordedAt: "2026-07-14T02:00:00.000Z",
    }));

    await saveWorklogWithDraft({
      billable: false,
      draftStore: drafts,
      durationMinutes: 35,
      job: firewallJob,
      note: "Added notes and confirmed service.",
      disposition: "complete",
      idempotencyKey: "worklog-firewall-riley-2",
      submit: submitted,
      technicianId: "staff-riley",
      visibility: "external",
      workType: "non_billable",
    });

    expect(submitted).toHaveBeenCalledWith(
      expect.objectContaining({
        billable: false,
        durationMinutes: 35,
        disposition: "complete",
        clientMutationId: "worklog-firewall-riley-2",
        jobId: "firewall-riley",
        summary: "Added notes and confirmed service.",
        visibility: "external",
        workType: "non_billable",
      }),
    );
    expect(await drafts.get("staff-riley", "firewall-riley")).toBeNull();
  });

  it("rejects a scheduled mobile Work Log without an outcome", async () => {
    await expect(
      saveWorklogWithDraft({
        draftStore: createWorklogDraftStore(),
        idempotencyKey: "worklog-firewall-riley-3",
        job: firewallJob,
        note: "Checked the firewall.",
        technicianId: "staff-riley",
        visibility: "external",
      }),
    ).rejects.toThrow("Choose what happens to this scheduled job");
  });

  it("requires a meaningful note before completion", () => {
    expect(() =>
      completeJobLocally({
        followUpNeeded: false,
        job: emptyJob,
        summary: "   ",
        visibility: "internal",
      }),
    ).toThrow("Add a work note before completing this job.");
  });
});
