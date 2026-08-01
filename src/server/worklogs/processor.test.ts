import { describe, expect, it, vi } from "vitest";

import type { WorklogDispositionCommand } from "./disposition";
import {
  createWorklogDispositionProcessor,
  type WorklogDispositionOperation,
  type WorklogDispositionRepository,
} from "./processor";

const command: WorklogDispositionCommand = {
  description: "Completed testing.",
  disposition: "return_to_queue",
  durationMinutes: 30,
  endedAt: "2026-08-03T01:00:00.000Z",
  idempotencyKey: "operation-1",
  requestId: "request-1",
  scheduled: true,
  startedAt: "2026-08-03T00:30:00.000Z",
};

describe("Work Log disposition processor", () => {
  it("does not create a second Work Log when outcome recovery is retried", async () => {
    const repository = createMemoryRepository();
    const saveWorklog = vi.fn().mockResolvedValue(undefined);
    const applyDisposition = vi
      .fn()
      .mockRejectedValueOnce(new Error("MSP Central schedule update failed"))
      .mockResolvedValueOnce(undefined);
    const processor = createWorklogDispositionProcessor({
      applyDisposition,
      repository,
      saveWorklog,
    });

    await expect(processor.process(command)).resolves.toMatchObject({
      status: "recovery_required",
      worklogSaved: true,
    });
    await expect(processor.process(command)).resolves.toMatchObject({
      status: "completed",
      worklogSaved: true,
    });

    expect(saveWorklog).toHaveBeenCalledTimes(1);
    expect(applyDisposition).toHaveBeenCalledTimes(2);
  });

  it("returns the completed receipt for a repeated idempotency key", async () => {
    const repository = createMemoryRepository();
    const saveWorklog = vi.fn().mockResolvedValue(undefined);
    const applyDisposition = vi.fn().mockResolvedValue(undefined);
    const processor = createWorklogDispositionProcessor({
      applyDisposition,
      repository,
      saveWorklog,
    });

    await processor.process(command);
    await processor.process(command);

    expect(saveWorklog).toHaveBeenCalledTimes(1);
    expect(applyDisposition).toHaveBeenCalledTimes(1);
  });
});

function createMemoryRepository(): WorklogDispositionRepository {
  const operations = new Map<string, WorklogDispositionOperation>();

  return {
    async begin(nextCommand) {
      const existing = operations.get(nextCommand.idempotencyKey);
      if (existing) return existing;
      const operation: WorklogDispositionOperation = {
        command: nextCommand,
        idempotencyKey: nextCommand.idempotencyKey,
        lastError: null,
        requestId: nextCommand.requestId,
        state: "pending",
      };
      operations.set(operation.idempotencyKey, operation);
      return operation;
    },
    async markCompleted(key) {
      update(key, { lastError: null, state: "completed" });
    },
    async markRecoveryRequired(key, error) {
      update(key, { lastError: error, state: "recovery_required" });
    },
    async markWorklogSaved(key) {
      update(key, { lastError: null, state: "worklog_saved" });
    },
  };

  function update(
    key: string,
    patch: Partial<WorklogDispositionOperation>,
  ) {
    const current = operations.get(key);
    if (!current) throw new Error("Operation was not found.");
    operations.set(key, { ...current, ...patch });
  }
}
