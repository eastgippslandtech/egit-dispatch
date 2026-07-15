import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import { MOBILE_JOB_FIXTURES } from "../testing/fixtures";

import { createApiTechnicianRepository } from "./api-technician-repository";

describe("createApiTechnicianRepository", () => {
  it("defensively filters schedule jobs to the requested calendar range", async () => {
    const api = {
      request: vi.fn(async () => ({
        data: {
          jobs: [
            MOBILE_JOB_FIXTURES.find((job) => job.id === "firewall-riley"),
            MOBILE_JOB_FIXTURES.find((job) => job.id === "remote-support-riley"),
          ].filter(Boolean),
        },
      })),
    } as unknown as ApiClient;
    const repository = createApiTechnicianRepository(api);

    const jobs = await repository.listSchedule({
      from: "2026-07-09",
      to: "2026-07-09",
    });

    expect(api.request).toHaveBeenCalledWith("/jobs?from=2026-07-09&to=2026-07-09");
    expect(jobs.map((job) => job.id)).toEqual(["firewall-riley"]);
  });
});
