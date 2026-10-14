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

  it("loads the live unassigned queue and sends an explicit take-and-schedule command", async () => {
    const job = MOBILE_JOB_FIXTURES.find((item) => item.id === "firewall-riley");
    const api = {
      request: vi.fn(async () => ({ data: { jobs: [job], receipt: { status: "applied" } } })),
    } as unknown as ApiClient;
    const repository = createApiTechnicianRepository(api);

    await expect(repository.listUnassignedJobs()).resolves.toEqual([job]);
    await repository.scheduleUnassignedJob({
      bookingType: "Onsite",
      clientMutationId: "claim-001",
      date: "2026-10-15",
      end: "11:00",
      jobId: "REQ-100301",
      start: "10:00",
    });

    expect(api.request).toHaveBeenNthCalledWith(1, "/unassigned");
    expect(api.request).toHaveBeenNthCalledWith(2, "/unassigned/REQ-100301/schedule", {
      body: expect.objectContaining({ clientMutationId: "claim-001", date: "2026-10-15" }),
      idempotencyKey: "claim-001",
    });
  });
});
