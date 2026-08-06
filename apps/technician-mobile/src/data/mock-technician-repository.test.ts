import { describe, expect, it } from "vitest";

import type {
  MobileStaff,
  SaveWorklogCommand,
  StartTimerCommand,
  StopTimerCommand,
} from "@/contracts/mobile";
import { MOBILE_STAFF_FIXTURES } from "../testing/fixtures";

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

  it.each([
    [
      "simeon@egit.com.au",
      {
        id: "staff-simeon",
        displayName: "Simeon",
        role: "admin",
        baseOffice: "Bairnsdale",
        mspCentralTechnicianId: null,
      },
    ],
    [
      "mattd@egit.com.au",
      {
        id: "staff-matt",
        displayName: "Matt",
        role: "technician",
        baseOffice: "Sale",
        mspCentralTechnicianId: null,
      },
    ],
    [
      "jervy@egit.com.au",
      {
        id: "staff-jervy",
        displayName: "Jervy",
        role: "technician",
        baseOffice: "Bairnsdale",
        mspCentralTechnicianId: null,
      },
    ],
    [
      "riley@egit.com.au",
      {
        id: "staff-riley",
        displayName: "Riley",
        role: "technician",
        baseOffice: "Bairnsdale",
        mspCentralTechnicianId: null,
      },
    ],
  ])("resolves the approved staff identity for %s", async (email, expected) => {
    const repository = new MockTechnicianRepository({ staffEmail: email });

    await expect(repository.getCurrentStaff()).resolves.toMatchObject({
      ...expected,
      email,
      zohoEmail: email,
      outlookEmail: email,
      outlookUserPrincipalName: email,
      mspCentralEmail: email,
    });
  });

  it("keeps Matt's canonical email when matching case-insensitively", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "MATTd@EGIT.COM.AU",
    });

    await expect(repository.getCurrentStaff()).resolves.toMatchObject({
      displayName: "Matt",
      email: "mattd@egit.com.au",
      zohoEmail: "mattd@egit.com.au",
      outlookEmail: "mattd@egit.com.au",
      mspCentralEmail: "mattd@egit.com.au",
    });
  });

  it("does not alias the selected exported staff fixture", async () => {
    const fixture = MOBILE_STAFF_FIXTURES.find(
      (candidate) => candidate.email === "riley@egit.com.au",
    ) as MobileStaff;
    const originalDisplayName = fixture.displayName;
    const repository = new MockTechnicianRepository({
      staffEmail: fixture.email,
    });

    try {
      fixture.displayName = "Mutated fixture";
      await expect(repository.getCurrentStaff()).resolves.toMatchObject({
        displayName: "Riley",
      });
    } finally {
      fixture.displayName = originalDisplayName;
    }
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

  it("replays timer commands without restoring or changing active state", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const startCommand: StartTimerCommand = {
      ...mutation,
      occurredAt: "2026-07-09T00:00:00.000Z",
    };
    const active = await repository.startTimer(startCommand);
    await expect(repository.startTimer(startCommand)).resolves.toEqual(active);

    const stopCommand: StopTimerCommand = {
      ...mutation,
      clientMutationId: "mutation-riley-002",
      occurredAt: "2026-07-09T00:16:01.000Z",
      timerId: active.id,
    };
    const stopped = await repository.stopTimer(stopCommand);

    await expect(repository.startTimer(startCommand)).resolves.toEqual(active);
    await expect(repository.stopTimer(stopCommand)).resolves.toEqual(stopped);
    await expect(
      repository.startTimer({
        ...startCommand,
        clientMutationId: "mutation-riley-003",
        occurredAt: "2026-07-09T00:20:00.000Z",
      }),
    ).resolves.toMatchObject({ id: "timer-mutation-riley-003" });
  });

  it("rejects conflicting timer idempotency-key reuse", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const startCommand: StartTimerCommand = {
      ...mutation,
      occurredAt: "2026-07-09T00:00:00.000Z",
    };
    const active = await repository.startTimer(startCommand);

    await expect(
      repository.startTimer({
        ...startCommand,
        occurredAt: "2026-07-09T00:01:00.000Z",
      }),
    ).rejects.toThrow("Idempotency key was reused for a different mutation.");

    const stopCommand: StopTimerCommand = {
      ...mutation,
      clientMutationId: "mutation-riley-002",
      occurredAt: "2026-07-09T00:16:01.000Z",
      timerId: active.id,
    };
    await repository.stopTimer(stopCommand);
    await expect(
      repository.stopTimer({
        ...stopCommand,
        occurredAt: "2026-07-09T00:17:00.000Z",
      }),
    ).rejects.toThrow("Idempotency key was reused for a different mutation.");
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

  it("rejects stale base versions but preserves exact receipt replay", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });
    const command: SaveWorklogCommand = {
      ...mutation,
      durationMinutes: 30,
      endedAt: "2026-07-09T01:15:00.000Z",
      startedAt: "2026-07-09T00:45:00.000Z",
      summary: "Updated firewall firmware.",
      timerSessionId: null,
      visibility: "internal",
    };
    const receipt = await repository.saveWorklog(command);

    await expect(repository.saveWorklog(command)).resolves.toEqual(receipt);
    await expect(
      repository.updateStatus({
        ...mutation,
        clientMutationId: "mutation-riley-stale-001",
        status: "In Progress",
      }),
    ).rejects.toThrow("Job version conflict.");
    await expect(repository.getJob("firewall-riley")).resolves.toMatchObject({
      status: "Scheduled",
      version: "mock-version-mutation-riley-001",
    });
  });

  it("rejects an arbitrary base version before mutation", async () => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });

    await expect(
      repository.updateStatus({
        ...mutation,
        baseVersion: "arbitrary-version",
        clientMutationId: "mutation-riley-arbitrary-001",
        status: "In Progress",
      }),
    ).rejects.toThrow("Job version conflict.");
    await expect(repository.getJob("firewall-riley")).resolves.toMatchObject({
      status: "Scheduled",
      version: "version-riley-firewall-1",
    });
  });

  it.each([
    [
      "startTimer",
      (repository: MockTechnicianRepository) =>
        repository.startTimer({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-start",
          jobId: "outlook-block-riley",
        }),
    ],
    [
      "stopTimer",
      (repository: MockTechnicianRepository) =>
        repository.stopTimer({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-stop",
          jobId: "outlook-block-riley",
          timerId: "timer-outlook",
        }),
    ],
    [
      "saveWorklog",
      (repository: MockTechnicianRepository) =>
        repository.saveWorklog({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-worklog",
          durationMinutes: 30,
          endedAt: "2026-07-09T01:15:00.000Z",
          jobId: "outlook-block-riley",
          startedAt: "2026-07-09T00:45:00.000Z",
          summary: "Not allowed",
          timerSessionId: null,
          visibility: "internal",
        }),
    ],
    [
      "updateStatus",
      (repository: MockTechnicianRepository) =>
        repository.updateStatus({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-status",
          jobId: "outlook-block-riley",
          status: "In Progress",
        }),
    ],
    [
      "attachEvidence",
      (repository: MockTechnicianRepository) =>
        repository.attachEvidence({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          byteLength: 128,
          clientMutationId: "outlook-evidence",
          fileName: "photo.jpg",
          jobId: "outlook-block-riley",
          kind: "photo",
          localUri: "file:///photo.jpg",
          mimeType: "image/jpeg",
          sha256: "fixed-sha256",
        }),
    ],
    [
      "addPart",
      (repository: MockTechnicianRepository) =>
        repository.addPart({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-part",
          jobId: "outlook-block-riley",
          name: "Patch lead",
          note: null,
          quantity: 1,
          sku: null,
        }),
    ],
    [
      "saveSignOff",
      (repository: MockTechnicianRepository) =>
        repository.saveSignOff({
          ...mutation,
          accepted: true,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-signoff",
          customerName: "Customer",
          jobId: "outlook-block-riley",
          signatureLocalUri: "file:///signature.png",
          signedAt: "2026-07-09T01:15:00.000Z",
        }),
    ],
    [
      "completeJob",
      (repository: MockTechnicianRepository) =>
        repository.completeJob({
          ...mutation,
          baseVersion: "version-riley-outlook-1",
          clientMutationId: "outlook-complete",
          followUpNeeded: false,
          jobId: "outlook-block-riley",
          summary: "Not allowed",
          visibility: "internal",
        }),
    ],
  ])("rejects %s for an Outlook-only event", async (_name, write) => {
    const repository = new MockTechnicianRepository({
      staffEmail: "riley@egit.com.au",
    });

    await expect(write(repository)).rejects.toThrow(
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
