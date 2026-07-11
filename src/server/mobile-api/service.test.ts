import { describe, expect, it } from "vitest";

import {
  listMobileJobs,
  rileyMobileAuth,
  saveMobileWorklog,
} from "./service";

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
});
