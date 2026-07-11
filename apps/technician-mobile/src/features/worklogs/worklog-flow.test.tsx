import { describe, expect, it } from "vitest";

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
