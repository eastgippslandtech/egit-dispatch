import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryCommandCentreDatabase } from "../db/database";
import { createMutationQueue } from "../features/sync/mutation-queue";
import { MOBILE_JOB_FIXTURES } from "../testing/fixtures";

import { createApiClient } from "../api/client";
import { createOfflineTechnicianRepository } from "./offline-technician-repository";

const firewallJob = MOBILE_JOB_FIXTURES.find((job) => job.id === "firewall-riley");

if (!firewallJob) {
  throw new Error("Firewall fixture is required.");
}

describe("offline technician repository", () => {
  let database: ReturnType<typeof createInMemoryCommandCentreDatabase>;
  let queue: ReturnType<typeof createMutationQueue>;

  beforeEach(() => {
    database = createInMemoryCommandCentreDatabase();
    queue = createMutationQueue(database);
  });

  it("returns cached jobs when the network is unavailable", async () => {
    await database.saveCachedJob(firewallJob, firewallJob.updatedAt);
    const repository = createOfflineTechnicianRepository({
      database,
      queue,
      remote: {
        getCurrentStaff: async () => firewallJob.technician,
        getJob: async () => {
          throw new Error("offline");
        },
        listSchedule: async () => {
          throw new Error("offline");
        },
      },
    });

    expect(await repository.listSchedule({ from: "2026-07-09", to: "2026-07-09" })).toEqual([
      firewallJob,
    ]);
  });

  it("does not show out-of-range remote jobs for the selected day", async () => {
    const repository = createOfflineTechnicianRepository({
      database,
      queue,
      remote: {
        getCurrentStaff: async () => firewallJob.technician,
        getJob: async () => firewallJob,
        listSchedule: async () => [
          MOBILE_JOB_FIXTURES.find((job) => job.id === "firewall-riley"),
          MOBILE_JOB_FIXTURES.find((job) => job.id === "remote-support-riley"),
        ].filter((job): job is NonNullable<typeof job> => Boolean(job)),
      },
    });

    const jobs = await repository.listSchedule({
      from: "2026-07-09",
      to: "2026-07-09",
    });

    expect(jobs.map((job) => job.id)).toEqual(["firewall-riley"]);
  });

  it("sends an idempotency key and marks one successful receipt", async () => {
    const calls: { headers: Record<string, string> }[] = [];
    const api = createApiClient({
      accessToken: "mobile-token",
      baseUrl: "https://command.egit.com.au/api/mobile/v1",
      fetcher: async (_url, init) => {
        if (!init) {
          throw new Error("Fetch options are required.");
        }
        calls.push({ headers: init.headers as Record<string, string> });
        return new Response(
          JSON.stringify({
            data: {
              receipt: {
                clientMutationId: "note-123",
                resourceId: "note-123",
                resourceVersion: "v2",
                status: "applied",
              },
            },
            meta: { requestId: "req-1", serverTime: "2026-07-09T00:00:00.000Z" },
          }),
          { status: 200 },
        );
      },
      requestId: () => "req-1",
    });
    await queue.enqueue({
      actionType: "notes",
      createdAt: "2026-07-09T00:00:00.000Z",
      dependsOn: [],
      id: "note-123",
      jobId: "firewall-riley",
      payload: { body: "Done", visibility: "internal" },
    });
    const repository = createOfflineTechnicianRepository({
      api,
      database,
      queue,
      remote: null,
    });

    await repository.syncNow();

    expect(calls[0].headers["Idempotency-Key"]).toBe("note-123");
    expect((await queue.listRunnable()).map((item) => item.id)).not.toContain(
      "note-123",
    );
  });

  it("queues the complete Work Log outcome unchanged when the remote save fails", async () => {
    const remoteSave = vi.fn(async () => {
      throw new Error("offline");
    });
    const repository = createOfflineTechnicianRepository({
      database,
      queue,
      remote: {
        getCurrentStaff: async () => firewallJob.technician,
        getJob: async () => firewallJob,
        listSchedule: async () => [firewallJob],
        saveWorklog: remoteSave,
      },
    });
    const command = {
      baseVersion: firewallJob.version,
      clientMutationId: "worklog-offline-outcome-1",
      disposition: "book_forward" as const,
      durationMinutes: 30,
      endedAt: "2026-07-09T01:00:00.000Z",
      forwardBooking: {
        bookingType: "Remote" as const,
        date: "2026-07-10",
        end: "11:00",
        start: "10:00",
        technicianEmail: "riley@egit.com.au",
        technicianId: "staff-riley",
        technicianName: "Riley",
      },
      installationId: "phone-1",
      jobId: firewallJob.id,
      occurredAt: "2026-07-09T01:00:00.000Z",
      startedAt: "2026-07-09T00:30:00.000Z",
      summary: "Booking forward after firmware testing.",
      timerSessionId: null,
      visibility: "external" as const,
      workType: "billable" as const,
    };

    const receipt = await repository.saveWorklog(command);
    const [queued] = await queue.listRunnable();

    expect(receipt.status).toBe("pending");
    expect(queued.id).toBe("worklog-offline-outcome-1");
    expect(queued.payload).toEqual(command);
  });
});
