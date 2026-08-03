import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { resolveMspCentralWorklogOwner } from "@/server/worklogs/owner";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";
import { createPostgresWorklogDispositionRepository } from "@/server/worklogs/repository";

import { POST } from "./route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/integrations/repository", () => ({
  createPostgresIntegrationRepository: vi.fn(),
}));

vi.mock("@/server/integrations/wake", () => ({
  wakeIntegrationProcessor: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(() => ({})),
}));

vi.mock("@/server/worklogs/owner", () => ({
  resolveMspCentralWorklogOwner: vi.fn(),
}));

vi.mock("@/server/worklogs/outcome-store", () => ({
  createPostgresWorklogOutcomeStore: vi.fn(),
}));

vi.mock("@/server/worklogs/repository", () => ({
  createPostgresWorklogDispositionRepository: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const createIntegrationRepositoryMock = vi.mocked(
  createPostgresIntegrationRepository,
);
const resolveOwnerMock = vi.mocked(resolveMspCentralWorklogOwner);
const createOutcomeStoreMock = vi.mocked(createPostgresWorklogOutcomeStore);
const createLegacyRepositoryMock = vi.mocked(
  createPostgresWorklogDispositionRepository,
);
const enqueue = vi.fn();
const findLegacy = vi.fn();
const listCalendarAssignments = vi.fn();

describe("MSP Central Work Log route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    resolveOwnerMock.mockResolvedValue({ id: "msp-simeon" });
    findLegacy.mockResolvedValue(undefined);
    listCalendarAssignments.mockResolvedValue([
      {
        eventId: "event-1",
        technicianId: "tech-simeon",
        userPrincipalName: "simeon@egit.com.au",
      },
    ]);
    createLegacyRepositoryMock.mockReturnValue({ find: findLegacy } as never);
    createOutcomeStoreMock.mockReturnValue({ listCalendarAssignments } as never);
    enqueue.mockResolvedValue({
      operation: { id: "operation-worklog-1", state: "queued" },
      replayed: false,
    });
    createIntegrationRepositoryMock.mockReturnValue({ enqueue } as never);
  });

  it("queues the Work Log before all disposition steps", async () => {
    const response = await POST(requestWith(command()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      idempotencyKey: "worklog-command-1",
      ok: true,
      operationId: "operation-worklog-1",
      status: "queued",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "helpdesk.worklog",
        idempotencyKey: "worklog-command-1",
        steps: expect.arrayContaining([
          expect.objectContaining({ stepKey: "msp:worklog" }),
          expect.objectContaining({ stepKey: "msp:status:resolved" }),
          expect.objectContaining({ stepKey: "command:clear-schedule" }),
        ]),
      }),
    );
    const queued = enqueue.mock.calls[0]![0];
    expect(queued.steps.findIndex((step: { stepKey: string }) => step.stepKey === "msp:worklog"))
      .toBeLessThan(queued.steps.findIndex((step: { stepKey: string }) => step.stepKey === "msp:status:resolved"));
  });

  it("migrates a legacy saved Work Log without writing it twice", async () => {
    findLegacy.mockResolvedValueOnce({
      command: { ...command(), durationMinutes: 30 },
      idempotencyKey: "worklog-command-1",
      lastError: "Outcome failed.",
      requestId: "request-1",
      state: "recovery_required",
    });

    const response = await POST(requestWith(command()));

    expect(response.status).toBe(202);
    const queued = enqueue.mock.calls[0]![0];
    expect(queued.idempotencyKey).toBe("worklog-command-1");
    expect(queued.steps.some((step: { stepKey: string }) => step.stepKey === "msp:worklog"))
      .toBe(false);
    expect(queued.steps.some((step: { stepKey: string }) => step.stepKey === "msp:status:resolved"))
      .toBe(true);
  });

  it("does not enqueue a completed legacy operation again", async () => {
    findLegacy.mockResolvedValueOnce({
      command: { ...command(), durationMinutes: 30 },
      idempotencyKey: "worklog-command-1",
      lastError: null,
      requestId: "request-1",
      state: "completed",
    });

    const response = await POST(requestWith(command()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      idempotencyKey: "worklog-command-1",
      ok: true,
      status: "synced",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

function command() {
  return {
    currentBooking: {
      eventId: "event-1",
      technicianId: "tech-simeon",
      userPrincipalName: "simeon@egit.com.au",
    },
    description: "Replaced the failed switch.",
    disposition: "complete",
    durationMinutes: 16,
    endedAt: "2026-08-04T10:16:00+10:00",
    idempotencyKey: "worklog-command-1",
    requestId: "request-1",
    scheduled: true,
    startedAt: "2026-08-04T10:00:00+10:00",
    visibility: "external",
    workType: "billable",
  };
}

function requestWith(body: unknown) {
  return new Request(
    "https://command.egit.com.au/api/internal/msp-central/worklogs",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}
