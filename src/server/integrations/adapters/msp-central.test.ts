import { describe, expect, it, vi } from "vitest";

import {
  AmbiguousIntegrationError,
  AuthenticationIntegrationError,
  PermanentIntegrationError,
} from "../errors";
import type { IntegrationOperationStep } from "../types";
import { createMspCentralAdapters } from "./msp-central";

describe("MSP Central integration adapters", () => {
  it("declares write safety for every action and maps schedule payloads", async () => {
    const updateRequestSchedule = vi.fn().mockResolvedValue(undefined);
    const adapters = createMspCentralAdapters({
      client: client({ updateRequestSchedule }),
    });

    expect(
      Object.fromEntries(
        Object.entries(adapters).map(([action, adapter]) => [
          action,
          adapter.writeSafety,
        ]),
      ),
    ).toMatchObject({
      "msp.add_note": "non_idempotent",
      "msp.add_worklog": "non_idempotent",
      "msp.merge_requests": "non_idempotent",
      "msp.schedule_request": "idempotent",
      "msp.update_status": "idempotent",
    });

    await adapters["msp.schedule_request"].execute(
      step("msp.schedule_request", {
        requestId: "request-42",
        scheduledEnd: "2026-08-04T11:00:00+10:00",
        scheduledStart: "2026-08-04T10:00:00+10:00",
        technicianId: "msp-simeon",
        technicianName: "Simeon",
      }),
    );

    expect(updateRequestSchedule).toHaveBeenCalledWith({
      requestId: "request-42",
      scheduledEnd: "2026-08-04T11:00:00+10:00",
      scheduledStart: "2026-08-04T10:00:00+10:00",
      technicianId: "msp-simeon",
      technicianName: "Simeon",
    });
  });

  it("reconciles an ambiguous Work Log by owner, rounded time, window, and content", async () => {
    const addRequestWorklog = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" }));
    const adapters = createMspCentralAdapters({
      client: client({
        addRequestWorklog,
        listRequestWorklogs: vi.fn().mockResolvedValue([
          {
            description: "<p>Replaced the failed power supply.</p>",
            end_time: { value: "1785803400000" },
            id: "worklog-9",
            is_billable: true,
            owner: { id: "msp-simeon", name: "Simeon" },
            start_time: { value: "1785801600000" },
            time_spent: { hours: "0", minutes: "30" },
          },
        ]),
      }),
    });

    await expect(
      adapters["msp.add_worklog"].execute(
        step("msp.add_worklog", {
          description: "Replaced the failed power supply.",
          durationMinutes: 16,
          endedAt: new Date(1785803400000).toISOString(),
          ownerId: "msp-simeon",
          requestId: "request-42",
          startedAt: new Date(1785801600000).toISOString(),
          worklogType: "billable",
        }),
      ),
    ).resolves.toMatchObject({ externalId: "worklog-9", reconciled: true });
  });

  it("requires review when an ambiguous Work Log cannot be proven", async () => {
    const adapters = createMspCentralAdapters({
      client: client({
        addRequestWorklog: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("socket timeout"), { code: "ETIMEDOUT" })),
        listRequestWorklogs: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(
      adapters["msp.add_worklog"].execute(
        step("msp.add_worklog", {
          description: "Completed diagnostics.",
          durationMinutes: 15,
          endedAt: "2026-08-04T10:15:00+10:00",
          ownerId: "msp-simeon",
          requestId: "request-42",
          startedAt: "2026-08-04T10:00:00+10:00",
          worklogType: "internal",
        }),
      ),
    ).rejects.toBeInstanceOf(AmbiguousIntegrationError);
  });

  it("reconciles customer Comms using content and requester visibility", async () => {
    const adapters = createMspCentralAdapters({
      client: client({
        addRequestNote: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("connection reset"), { code: "ECONNRESET" })),
        listRequestNotes: vi.fn().mockResolvedValue([
          {
            created_time: { value: "1785801600000" },
            description: "<p>Your printer is back online.</p>",
            id: "note-3",
            show_to_requester: true,
          },
        ]),
      }),
    });

    await expect(
      adapters["msp.add_note"].execute(
        step("msp.add_note", {
          description: "Your printer is back online.",
          occurredAt: new Date(1785801600000).toISOString(),
          requestId: "request-42",
          showToRequester: true,
          visibility: "customer",
        }),
      ),
    ).resolves.toMatchObject({ externalId: "note-3", reconciled: true });
  });

  it("maps definite provider failures without leaking into blind retries", async () => {
    const authAdapters = createMspCentralAdapters({
      client: client({
        updateRequestStatus: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("Denied"), { status: 401 })),
      }),
    });
    const validationAdapters = createMspCentralAdapters({
      client: client({
        updateRequestStatus: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("Invalid status"), { status: 400 })),
      }),
    });

    await expect(
      authAdapters["msp.update_status"].execute(
        step("msp.update_status", { requestId: "42", status: "Resolved" }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationIntegrationError);
    await expect(
      validationAdapters["msp.update_status"].execute(
        step("msp.update_status", { requestId: "42", status: "Resolved" }),
      ),
    ).rejects.toBeInstanceOf(PermanentIntegrationError);
  });

  it("treats API-level access denied as an authentication failure", async () => {
    const adapters = createMspCentralAdapters({
      client: client({
        updateRequestStatus: vi
          .fn()
          .mockRejectedValue(new Error("MSP Central API request was denied.")),
      }),
    });

    await expect(
      adapters["msp.update_status"].execute(
        step("msp.update_status", { requestId: "42", status: "Resolved" }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationIntegrationError);
  });

  it("does not reconcile an old identical customer message", async () => {
    const adapters = createMspCentralAdapters({
      client: client({
        addRequestNote: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
        listRequestNotes: vi.fn().mockResolvedValue([
          {
            created_time: { value: "1780000000000" },
            description: "Your printer is back online.",
            id: "old-note",
            show_to_requester: true,
          },
        ]),
      }),
    });

    await expect(
      adapters["msp.add_note"].execute(
        step("msp.add_note", {
          description: "Your printer is back online.",
          occurredAt: "2026-08-04T10:00:00+10:00",
          requestId: "request-42",
          visibility: "customer",
        }),
      ),
    ).rejects.toBeInstanceOf(AmbiguousIntegrationError);
  });

  it("reconciles a timed-out merge only when the child is gone and parent remains", async () => {
    const getRequest = vi.fn(async (requestId: string) =>
      requestId === "parent-7"
        ? ({ id: "parent-7", requestNumber: "REQ-7" } as never)
        : undefined,
    );
    const adapters = createMspCentralAdapters({
      client: client({
        getRequest,
        mergeRequests: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
      }),
    });

    await expect(
      adapters["msp.merge_requests"].execute(
        step("msp.merge_requests", {
          childRequestId: "duplicate-42",
          parentRequestId: "parent-7",
        }),
      ),
    ).resolves.toMatchObject({ reconciled: true });
  });

  it("reconciles ambiguous request creation by its deterministic marker", async () => {
    const findRequestByCommandFingerprint = vi.fn().mockResolvedValue({
      id: "request-new",
      requestNumber: "REQ-NEW",
    });
    const adapters = createMspCentralAdapters({
      client: client({
        createRequest: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
        findRequestByCommandFingerprint,
      }),
    });

    await expect(
      adapters["msp.create_request"].execute(
        step("msp.create_request", {
          commandFingerprint: "a".repeat(64),
          description: "Printer cannot reach the network.",
          priority: "High",
          subject: "Printer offline",
        }),
      ),
    ).resolves.toMatchObject({
      externalId: "request-new",
      reconciled: true,
      requestNumber: "REQ-NEW",
    });
    expect(findRequestByCommandFingerprint).toHaveBeenCalledWith("a".repeat(64));
  });
});

function step(action: string, payload: Record<string, unknown>): IntegrationOperationStep {
  return {
    action,
    attemptCount: 1,
    connector: "msp_central",
    createdAt: "2026-08-04T00:00:00.000Z",
    id: `step-${action}`,
    leaseToken: "lease-1",
    operationId: "operation-1",
    payload,
    state: "processing",
    stepKey: action,
    stepOrder: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    addRequestNote: vi.fn().mockResolvedValue(undefined),
    addRequestWorklog: vi.fn().mockResolvedValue(undefined),
    assignRequest: vi.fn().mockResolvedValue(undefined),
    clearRequestSchedule: vi.fn().mockResolvedValue(undefined),
    getRequest: vi.fn().mockResolvedValue({ id: "request-42" }),
    getRequestContext: vi.fn(),
    getTechnician: vi.fn(),
    listCustomers: vi.fn(),
    listRequestNotes: vi.fn().mockResolvedValue([]),
    listRequests: vi.fn(),
    listRequestWorklogs: vi.fn().mockResolvedValue([]),
    listSites: vi.fn(),
    listTechnicians: vi.fn(),
    createRequest: vi.fn().mockResolvedValue({ id: "new", requestNumber: "REQ-NEW" }),
    findRequestByCommandFingerprint: vi.fn().mockResolvedValue(undefined),
    mergeRequests: vi.fn().mockResolvedValue(undefined),
    refreshAccessToken: vi.fn(),
    setRequestResolution: vi.fn().mockResolvedValue(undefined),
    updateRequestSchedule: vi.fn().mockResolvedValue(undefined),
    updateRequestStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}
