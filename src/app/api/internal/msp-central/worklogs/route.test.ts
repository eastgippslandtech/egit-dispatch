import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import {
  applyTicketTemplate,
  serviceTicketTemplates,
  updateTrackItem,
} from "@/server/dispatch/service-workflow";
import { getConfiguredRequestWorkflowRepository } from "@/server/dispatch/service-workflow-repository";
import { createPostgresWorklogMigrationCoordinator } from "@/server/worklogs/migration";
import { resolveMspCentralWorklogOwner } from "@/server/worklogs/owner";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";

import { POST } from "./route";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/integrations/wake", () => ({
  wakeIntegrationProcessor: vi.fn(),
}));

vi.mock("@/server/dispatch/service-workflow-repository", () => ({
  getConfiguredRequestWorkflowRepository: vi.fn(),
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

vi.mock("@/server/worklogs/migration", () => ({
  createPostgresWorklogMigrationCoordinator: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const getWorkflowRepositoryMock = vi.mocked(
  getConfiguredRequestWorkflowRepository,
);
const createMigrationCoordinatorMock = vi.mocked(
  createPostgresWorklogMigrationCoordinator,
);
const resolveOwnerMock = vi.mocked(resolveMspCentralWorklogOwner);
const createOutcomeStoreMock = vi.mocked(createPostgresWorklogOutcomeStore);
const migrate = vi.fn();
const enqueued: Array<{ steps: Array<{ stepKey: string }>; idempotencyKey: string }> = [];
const listCalendarAssignments = vi.fn();

describe("MSP Central Work Log route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueued.length = 0;
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    resolveOwnerMock.mockResolvedValue({ id: "msp-simeon" });
    listCalendarAssignments.mockResolvedValue([
      {
        eventId: "event-1",
        technicianId: "tech-simeon",
        userPrincipalName: "simeon@egit.com.au",
      },
    ]);
    createOutcomeStoreMock.mockReturnValue({ listCalendarAssignments } as never);
    getWorkflowRepositoryMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
    } as never);
    migrate.mockImplementation(async ({ command: submitted, createOperation }) => {
      enqueued.push(createOperation(submitted, false));
      return {
        kind: "operation",
        operation: { id: "operation-worklog-1", state: "queued" },
        replayed: false,
      };
    });
    createMigrationCoordinatorMock.mockReturnValue({ enqueue: migrate } as never);
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
    expect(enqueued[0]).toEqual(
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
    const queued = enqueued[0]!;
    expect(queued.steps.findIndex((step: { stepKey: string }) => step.stepKey === "msp:worklog"))
      .toBeLessThan(queued.steps.findIndex((step: { stepKey: string }) => step.stepKey === "msp:status:resolved"));
  });

  it("migrates a legacy saved Work Log without writing it twice", async () => {
    migrate.mockImplementationOnce(async ({ command: submitted, createOperation }) => {
      enqueued.push(createOperation(submitted, true));
      return {
        kind: "operation",
        operation: { id: "operation-worklog-1", state: "queued" },
        replayed: false,
      };
    });

    const response = await POST(requestWith(command()));

    expect(response.status).toBe(202);
    const queued = enqueued[0]!;
    expect(queued.idempotencyKey).toBe("worklog-command-1");
    expect(queued.steps.some((step: { stepKey: string }) => step.stepKey === "msp:worklog"))
      .toBe(false);
    expect(queued.steps.some((step: { stepKey: string }) => step.stepKey === "msp:status:resolved"))
      .toBe(true);
  });

  it("does not enqueue a completed legacy operation again", async () => {
    migrate.mockResolvedValueOnce({
      kind: "legacy",
      operationId: "legacy:worklog-command-1",
      status: "synced",
    });

    const response = await POST(requestWith(command()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      idempotencyKey: "worklog-command-1",
      ok: true,
      status: "synced",
    });
    expect(enqueued).toEqual([]);
  });

  it("reports an in-flight legacy-owned Work Log without starting a generic duplicate", async () => {
    migrate.mockResolvedValueOnce({
      kind: "legacy",
      operationId: "legacy:worklog-command-1",
      status: "syncing",
    });

    const response = await POST(requestWith(command()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      operationId: "legacy:worklog-command-1",
      status: "syncing",
    });
    expect(enqueued).toEqual([]);
  });

  it("blocks completion while mandatory Track items are unresolved", async () => {
    const workflow = requestWorkflow();
    getWorkflowRepositoryMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(workflow),
      save: vi.fn(),
    } as never);

    const response = await POST(requestWith({ ...command(), solution: "Fixed and tested." }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      blockers: [expect.objectContaining({ code: "track_incomplete" })],
      ok: false,
    });
    expect(migrate).not.toHaveBeenCalled();
  });

  it("blocks a template completion without its required customer solution", async () => {
    getWorkflowRepositoryMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(completedRequestWorkflow()),
      save: vi.fn(),
    } as never);

    const response = await POST(requestWith(command()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      blockers: [expect.objectContaining({ code: "solution_required" })],
      ok: false,
    });
  });

  it("queues completion after the Track and solution guardrails pass", async () => {
    getWorkflowRepositoryMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(completedRequestWorkflow()),
      save: vi.fn(),
    } as never);

    const response = await POST(
      requestWith({ ...command(), solution: "Fixed and tested with the customer." }),
    );

    expect(response.status).toBe(202);
    expect(migrate).toHaveBeenCalledOnce();
  });
});

function requestWorkflow() {
  const template = serviceTicketTemplates[0];
  return applyTicketTemplate({
    actorEmail: "simeon@egit.com.au",
    classification: {
      confidence: 1,
      reason: "Manual",
      source: "manual",
      templateId: template.id,
    },
    requestId: "request-1",
    template,
  });
}

function completedRequestWorkflow() {
  let workflow = requestWorkflow();
  for (const item of workflow.track!.items) {
    workflow = updateTrackItem(workflow, item.id, {
      actorEmail: "simeon@egit.com.au",
      status: "completed",
      value:
        item.type === "checkbox" || item.type === "approval"
          ? undefined
          : "Captured detail",
    });
  }
  return workflow;
}

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
