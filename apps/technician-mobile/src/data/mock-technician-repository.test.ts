import { describe, expect, it } from "vitest";

import type {
  AddPartCommand,
  SaveWorklogCommand,
  StartTimerCommand,
  StopTimerCommand,
} from "@/contracts/mobile";

import { MockTechnicianRepository } from "./mock-technician-repository";

const mutation = {
  baseVersion: "version-riley-firewall-1",
  clientMutationId: "mutation-riley-001",
  installationId: "installation-test-001",
  jobId: "firewall-riley",
  occurredAt: "2026-07-09T01:15:00.000Z",
};

describe("MockTechnicianRepository", () => {
  it("returns only the signed-in technician schedule", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const jobs = await repository.listSchedule({
      from: "2026-07-09",
      to: "2026-07-09",
    });

    expect(jobs.length).toBeGreaterThan(0);
    expect(
      jobs.every((job) => job.technician.email === "riley@egit.com.au"),
    ).toBe(true);
    expect(jobs.map((job) => job.id)).not.toContain("server-expansion-matt");
  });

  it("keeps Outlook-only events read-only", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const job = await repository.getJob("outlook-block-riley");

    expect(job.permissions.canWriteWorklog).toBe(false);
    expect(job.source).toBe("outlook");
  });

  it("returns an inclusive, chronological date range", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const jobs = await repository.listSchedule({
      from: "2026-07-09",
      to: "2026-07-10",
    });

    expect(jobs.map((job) => job.id)).toEqual([
      "firewall-riley",
      "outlook-block-riley",
      "remote-support-riley",
    ]);
  });

  it("resolves the canonical signed-in staff identity case-insensitively", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "MATTd@EGIT.COM.AU",
    });

    await expect(repository.getCurrentStaff()).resolves.toMatchObject({
      displayName: "Matt",
      email: "mattd@egit.com.au",
      role: "technician",
    });
  });

  it("rejects access to another technician's jobs", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });

    await expect(repository.getJob("server-expansion-matt")).rejects.toThrow(
      "Job is not assigned to the signed-in technician.",
    );
  });

  it("creates and stops a deterministic timer from command timestamps", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const startCommand: StartTimerCommand = {
      ...mutation,
      occurredAt: "2026-07-09T00:00:00.000Z",
    };

    const active = await repository.startTimer(startCommand);
    const stopCommand: StopTimerCommand = {
      ...mutation,
      clientMutationId: "mutation-riley-002",
      occurredAt: "2026-07-09T00:16:01.000Z",
      timerId: active.id,
    };
    const stopped = await repository.stopTimer(stopCommand);

    expect(active).toEqual({
      id: "timer-mutation-riley-001",
      jobId: "firewall-riley",
      technicianId: "staff-riley",
      startedAt: "2026-07-09T00:00:00.000Z",
      pausedAt: null,
      accumulatedPausedSeconds: 0,
    });
    expect(stopped).toMatchObject({
      actualElapsedMinutes: 17,
      roundedMinutes: 30,
      stoppedAt: "2026-07-09T00:16:01.000Z",
    });
  });

  it("returns truthful deterministic mock receipts for writable mutations", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const command: SaveWorklogCommand = {
      ...mutation,
      durationMinutes: 30,
      endedAt: "2026-07-09T01:15:00.000Z",
      startedAt: "2026-07-09T00:45:00.000Z",
      summary: "Updated firewall firmware and verified connectivity.",
      timerSessionId: null,
      visibility: "internal",
    };

    await expect(repository.saveWorklog(command)).resolves.toEqual({
      clientMutationId: "mutation-riley-001",
      mode: "mock",
      resourceId: "mock-worklog-mutation-riley-001",
      resourceVersion: "mock-version-mutation-riley-001",
      status: "pending",
      recordedAt: "2026-07-09T01:15:00.000Z",
    });
  });

  it("rejects every write to an Outlook-only event", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const command: AddPartCommand = {
      ...mutation,
      baseVersion: "version-riley-outlook-1",
      clientMutationId: "mutation-riley-outlook-001",
      jobId: "outlook-block-riley",
      name: "Patch lead",
      note: null,
      quantity: 1,
      sku: null,
    };

    await expect(repository.addPart(command)).rejects.toThrow(
      "This Outlook event is read-only.",
    );
  });

  it("rejects reuse of an idempotency key for a different mutation", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const worklog: SaveWorklogCommand = {
      ...mutation,
      durationMinutes: 30,
      endedAt: "2026-07-09T01:15:00.000Z",
      startedAt: "2026-07-09T00:45:00.000Z",
      summary: "Updated firewall firmware.",
      timerSessionId: null,
      visibility: "internal",
    };
    await repository.saveWorklog(worklog);

    await expect(
      repository.addPart({
        ...mutation,
        jobId: "outlook-block-riley",
        name: "Patch lead",
        note: null,
        quantity: 1,
        sku: null,
      }),
    ).rejects.toThrow("Idempotency key was reused for a different mutation.");
  });
});
