import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import { MOBILE_JOB_FIXTURES } from "../testing/fixtures";

import { createApiTechnicianRepository } from "./api-technician-repository";

describe("createApiTechnicianRepository", () => {
  it("loads the active timer from the shared mobile API", async () => {
    const api = {
      request: vi.fn(async () => ({
        data: {
          timer: {
            accumulatedPausedSeconds: 0,
            id: "timer-riley-live",
            jobId: "firewall-riley",
            pausedAt: null,
            startedAt: "2026-08-14T01:00:00.000Z",
            technicianId: "staff-riley",
          },
        },
      })),
    } as unknown as ApiClient;
    const repository = createApiTechnicianRepository(api);
    if (!repository.getActiveTimer) {
      throw new Error("API repository must support the active timer endpoint.");
    }

    await expect(repository.getActiveTimer()).resolves.toMatchObject({
      id: "timer-riley-live",
      jobId: "firewall-riley",
    });
    expect(api.request).toHaveBeenCalledWith("/timer");
  });

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
