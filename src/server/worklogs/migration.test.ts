import { describe, expect, it, vi } from "vitest";

import type { EnqueueIntegrationOperation } from "@/server/integrations/types";

import type { WorklogDispositionCommand } from "./disposition";
import {
  createWorklogMigrationCoordinator,
  type WorklogMigrationTransaction,
} from "./migration";
import type { WorklogDispositionOperation } from "./processor";

const command: WorklogDispositionCommand = {
  description: "Completed testing.",
  disposition: "complete",
  durationMinutes: 30,
  endedAt: "2026-08-03T01:00:00.000Z",
  idempotencyKey: "worklog-command-1",
  requestId: "request-1",
  scheduled: true,
  startedAt: "2026-08-03T00:30:00.000Z",
  visibility: "external",
  workType: "billable",
};

describe("legacy Work Log migration", () => {
  it("atomically claims and links an incomplete legacy Work Log to one generic operation", async () => {
    const legacy = legacyOperation({ state: "worklog_saved" });
    const harness = migrationHarness(legacy);
    const createOperation = vi.fn((_, worklogAlreadySaved: boolean) =>
      genericOperation(worklogAlreadySaved),
    );
    const coordinator = createWorklogMigrationCoordinator(harness);

    const result = await coordinator.enqueue({ command, createOperation });

    expect(result).toMatchObject({
      kind: "operation",
      operation: { id: "generic-operation-1", state: "queued" },
    });
    expect(createOperation).toHaveBeenCalledWith(command, true);
    expect(harness.legacy()).toMatchObject({
      executionOwner: "generic",
      migratedOperationId: "generic-operation-1",
    });
    expect(harness.enqueued).toHaveLength(1);
    expect(harness.enqueued[0]!.steps.map((step) => step.stepKey)).not.toContain(
      "msp:worklog",
    );
  });

  it("rolls back the generic claim when enqueue fails", async () => {
    const harness = migrationHarness(legacyOperation({ state: "pending" }), {
      enqueueError: new Error("queue unavailable"),
    });
    const coordinator = createWorklogMigrationCoordinator(harness);

    await expect(
      coordinator.enqueue({
        command,
        createOperation: () => genericOperation(false),
      }),
    ).rejects.toThrow("queue unavailable");

    expect(harness.legacy()).toMatchObject({
      executionOwner: undefined,
      migratedOperationId: undefined,
    });
    expect(harness.enqueued).toEqual([]);
  });

  it("does not enqueue when the legacy processor already owns the Work Log", async () => {
    const harness = migrationHarness(
      legacyOperation({ executionOwner: "legacy", state: "pending" }),
    );
    const coordinator = createWorklogMigrationCoordinator(harness);

    const result = await coordinator.enqueue({
      command,
      createOperation: () => genericOperation(false),
    });

    expect(result).toMatchObject({ kind: "legacy", status: "syncing" });
    expect(harness.enqueued).toEqual([]);
  });
});

function migrationHarness(
  initial: WorklogDispositionOperation | undefined,
  { enqueueError }: { enqueueError?: Error } = {},
) {
  let stored = initial ? structuredClone(initial) : undefined;
  const enqueued: EnqueueIntegrationOperation[] = [];
  return {
    enqueued,
    legacy: () => stored,
    transaction: async <T>(
      callback: (transaction: WorklogMigrationTransaction) => Promise<T>,
    ) => {
      const staged = stored ? structuredClone(stored) : undefined;
      const stagedOperations: EnqueueIntegrationOperation[] = [];
      const result = await callback({
        claimGeneric: async () => {
          if (staged && !staged.executionOwner) {
            staged.executionOwner = "generic";
          }
        },
        enqueue: async (operation) => {
          if (enqueueError) throw enqueueError;
          stagedOperations.push(operation);
          return {
            operation: { id: "generic-operation-1", state: "queued" },
            replayed: false,
          };
        },
        findLegacyForUpdate: async () => staged,
        linkGeneric: async (_key, operationId) => {
          if (staged) staged.migratedOperationId = operationId;
        },
      });
      stored = staged;
      enqueued.push(...stagedOperations);
      return result;
    },
  };
}

function legacyOperation(
  patch: Partial<WorklogDispositionOperation>,
): WorklogDispositionOperation {
  return {
    command,
    executionOwner: undefined,
    idempotencyKey: command.idempotencyKey,
    lastError: null,
    migratedOperationId: undefined,
    requestId: command.requestId,
    state: "pending",
    ...patch,
  };
}

function genericOperation(
  worklogAlreadySaved: boolean,
): EnqueueIntegrationOperation {
  return {
    actionType: "helpdesk.worklog",
    actorEmail: "simeon@egit.com.au",
    idempotencyKey: command.idempotencyKey,
    payload: { worklogAlreadySaved },
    requestId: command.requestId,
    steps: worklogAlreadySaved
      ? []
      : [
          {
            action: "msp.add_worklog",
            connector: "msp_central",
            payload: {},
            stepKey: "msp:worklog",
          },
        ],
  };
}
