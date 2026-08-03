import { describe, expect, it, vi } from "vitest";

import {
  createIntegrationRepository,
  type IntegrationSql,
} from "./repository";
import type { IntegrationOperation } from "./types";

describe("integration recovery repository", () => {
  it("retries and writes the attributed audit event in one transaction", async () => {
    const { audits, repository, transaction } = harness("review_required");

    await expect(
      repository.retryOperationWithAudit({
        actorEmail: "Simeon@EGIT.com.au",
        operationId: "operation-1",
      }),
    ).resolves.toMatchObject({ state: "retrying" });

    expect(transaction).toHaveBeenCalledOnce();
    expect(audits).toEqual([
      expect.objectContaining({
        actorEmail: "simeon@egit.com.au",
        eventType: "integration_operation_retry_requested",
        operatorAction: "retry",
        operationId: "operation-1",
        outcome: "retrying",
        requestId: "REQ-1",
      }),
    ]);
  });

  it("cancels and writes the attributed audit event in one transaction", async () => {
    const { audits, repository, transaction } = harness("retrying");

    await expect(
      repository.cancelOperationWithAudit({
        actorEmail: "simeon@egit.com.au",
        operationId: "operation-1",
      }),
    ).resolves.toMatchObject({ state: "cancelled" });

    expect(transaction).toHaveBeenCalledOnce();
    expect(audits[0]).toMatchObject({
      actorEmail: "simeon@egit.com.au",
      operatorAction: "cancel",
      outcome: "cancelled",
    });
  });

  it("does not report or audit cancellation when the operation is in flight", async () => {
    const { audits, repository, transaction } = harness("syncing", {
      cancelOperation: [],
    });

    await expect(
      repository.cancelOperationWithAudit({
        actorEmail: "simeon@egit.com.au",
        operationId: "operation-1",
      }),
    ).rejects.toThrow("not cancellable");

    expect(transaction).toHaveBeenCalledOnce();
    expect(audits).toEqual([]);
  });

  it("maps due counts, review counts, and step results without exposing payloads", async () => {
    const { repository } = harness("review_required", {
      countDueSteps: [{ count: 3 }],
      getOperationCounts: [{ pending: 4, reviewRequired: 2 }],
      getStepResults: [
        { result: { externalId: "event-1" }, stepKey: "outlook:lead" },
      ],
    });

    await expect(repository.countDueSteps()).resolves.toBe(3);
    await expect(repository.getOperationCounts()).resolves.toEqual({
      pending: 4,
      reviewRequired: 2,
    });
    await expect(repository.getStepResults("operation-1")).resolves.toEqual({
      "outlook:lead": { externalId: "event-1" },
    });
  });

  it("normalizes actor email for ownership-scoped operation reads", async () => {
    const owned = {
      actionType: "schedule.booking",
      actorEmail: "jervy@egit.com.au",
      attemptCount: 1,
      createdAt: "2026-08-03T00:00:00.000Z",
      id: "operation-owned",
      idempotencyKey: "schedule-owned",
      inputFingerprint: "b".repeat(64),
      payload: {},
      requestId: "REQ-2",
      state: "syncing" as const,
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    const { query, repository } = harness("review_required", {
      getOperationForActor: [owned],
      listActiveOperationsForActor: [owned],
    });

    await expect(
      repository.getOperationForActor("operation-owned", "  Jervy@EGIT.com.au "),
    ).resolves.toBe(owned);
    await expect(
      repository.listActiveOperationsForActor({
        actorEmail: " JERVY@egit.com.au ",
        limit: 25,
      }),
    ).resolves.toEqual([owned]);

    expect(query).toHaveBeenCalledWith("getOperationForActor", [
      "operation-owned",
      "jervy@egit.com.au",
    ]);
    expect(query).toHaveBeenCalledWith("listActiveOperationsForActor", [
      "jervy@egit.com.au",
      25,
    ]);
  });
});

function harness(
  initialState: IntegrationOperation["state"],
  fixed: Partial<Record<string, unknown[]>> = {},
) {
  const audits: unknown[] = [];
  const operation: IntegrationOperation = {
    actionType: "helpdesk.worklog",
    actorEmail: "jervy@egit.com.au",
    attemptCount: 1,
    createdAt: "2026-08-03T00:00:00.000Z",
    id: "operation-1",
    idempotencyKey: "worklog-command-1",
    inputFingerprint: "a".repeat(64),
    payload: {},
    requestId: "REQ-1",
    state: initialState,
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
  const query = vi.fn<IntegrationSql["query"]>(async (name, values) => {
    if (fixed[name]) return fixed[name]!;
    if (name === "retryOperation") {
      operation.state = "retrying";
      operation.updatedAt = String(values[1]);
      return [operation];
    }
    if (name === "cancelOperation") {
      operation.state = "cancelled";
      operation.updatedAt = String(values[1]);
      return [operation];
    }
    if (name === "appendAudit") {
      audits.push(values[0]);
      return [];
    }
    throw new Error(`Unexpected query ${name}`);
  });
  const sql = {} as IntegrationSql;
  const transaction = vi.fn(async <T>(callback: (tx: IntegrationSql) => Promise<T>) =>
    callback(sql),
  );
  Object.assign(sql, { query, transaction });
  return {
    audits,
    query,
    repository: createIntegrationRepository(sql),
    transaction,
  };
}
