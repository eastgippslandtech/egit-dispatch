import { describe, expect, it } from "vitest";

import {
  createIntegrationRepository,
  type IntegrationSql,
} from "./repository";
import type {
  EnqueueIntegrationOperation,
  IntegrationAuditEvent,
  IntegrationConnectorHealth,
  IntegrationOperation,
  IntegrationOperationStep,
} from "./types";

function operation(): EnqueueIntegrationOperation {
  return {
    actionType: "request.sync",
    actorEmail: "dispatch@example.com",
    idempotencyKey: "request-42-sync-v1",
    payload: { changes: { status: "scheduled" }, requestId: "42" },
    requestId: "request-42",
    sourceVersion: "v1",
    steps: [
      {
        action: "request.update",
        connector: "msp_central",
        payload: { requestId: "42" },
        stepKey: "msp.update",
      },
      {
        action: "request.notify",
        connector: "push",
        payload: { message: "Scheduled", requestId: "42" },
        stepKey: "push.notify",
      },
    ],
  };
}

function fakeSql() {
  const operations: IntegrationOperation[] = [];
  const steps: IntegrationOperationStep[] = [];
  const audits: IntegrationAuditEvent[] = [];
  const health = new Map<string, IntegrationConnectorHealth>();
  const sql: IntegrationSql = {
    async query(name, values) {
      const now = "2026-08-03T10:30:00.000Z";

      if (name === "findOperationByKey") {
        return operations.filter((operation) => operation.idempotencyKey === values[0]);
      }
      if (name === "insertOperation") {
        const [input, inputFingerprint, actorEmail] = values as [
          EnqueueIntegrationOperation,
          string,
          string,
        ];
        if (operations.some((operation) => operation.idempotencyKey === input.idempotencyKey)) {
          return [];
        }
        const stored: IntegrationOperation = {
          actionType: input.actionType,
          actorEmail,
          attemptCount: 0,
          createdAt: now,
          id: `operation-${operations.length + 1}`,
          idempotencyKey: input.idempotencyKey,
          inputFingerprint,
          payload: input.payload,
          requestId: input.requestId ?? input.idempotencyKey,
          sourceVersion: input.sourceVersion,
          state: "queued",
          updatedAt: now,
        };
        operations.push(stored);
        return [stored];
      }
      if (name === "insertStep") {
        const [operationId, step, stepOrder] = values as [
          string,
          EnqueueIntegrationOperation["steps"][number],
          number,
        ];
        const stored: IntegrationOperationStep = {
          ...step,
          attemptCount: 0,
          createdAt: now,
          id: `step-${steps.length + 1}`,
          operationId,
          state: "queued",
          stepOrder,
          updatedAt: now,
        };
        steps.push(stored);
        return [stored];
      }
      if (name === "expireExpiredLeases") {
        const [changedAt] = values as [string];
        for (const step of steps) {
          if (
            step.state === "processing" &&
            step.leaseExpiresAt &&
            step.leaseExpiresAt <= changedAt
          ) {
            step.lastError ??= "Integration step lease expired before completion.";
            step.leaseExpiresAt = undefined;
            step.leaseToken = undefined;
            step.state = "review_required";
            step.workerId = undefined;
            const parent = operations.find(
              (operation) => operation.id === step.operationId,
            );
            if (parent && parent.state !== "cancelled" && parent.state !== "synced") {
              parent.lastError ??= "Integration step lease expired before completion.";
              parent.state = "review_required";
            }
          }
        }
        return [];
      }
      if (name === "claimDueSteps") {
        const [claimNow, workerId, leaseExpiresAt, limit] = values as [
          string,
          string,
          string,
          number,
        ];
        const claimed = steps
          .filter(
            (step) =>
              (step.state === "queued" || step.state === "retrying") &&
              (!step.nextAttemptAt || step.nextAttemptAt <= claimNow) &&
              !["review_required", "cancelled", "synced"].includes(
                operations.find((operation) => operation.id === step.operationId)
                  ?.state ?? "cancelled",
              ) &&
              !steps.some(
                (predecessor) =>
                  predecessor.operationId === step.operationId &&
                  predecessor.stepOrder < step.stepOrder &&
                  predecessor.state !== "succeeded",
              ),
          )
          .sort((left, right) => left.stepOrder - right.stepOrder)
          .slice(0, limit);
        for (const step of claimed) {
          step.attemptCount += 1;
          step.leaseExpiresAt = leaseExpiresAt;
          step.leaseToken = `lease-${step.id}`;
          step.startedAt ??= claimNow;
          step.state = "processing";
          step.updatedAt = claimNow;
          step.workerId = workerId;
        }
        return claimed;
      }
      if (name === "markStepSucceeded") {
        const [stepId, leaseToken, result, completedAt] = values as [
          string,
          string,
          Record<string, unknown>,
          string,
        ];
        const step = steps.find(
          (candidate) => candidate.id === stepId && candidate.leaseToken === leaseToken,
        );
        if (!step) return [];
        step.completedAt = completedAt;
        step.leaseExpiresAt = undefined;
        step.lastError = undefined;
        step.nextAttemptAt = undefined;
        step.result = result;
        step.state = "succeeded";
        step.updatedAt = completedAt;
        const parent = operations.find((operation) => operation.id === step.operationId);
        if (
          parent &&
          steps
            .filter((candidate) => candidate.operationId === step.operationId)
            .every((candidate) => candidate.state === "succeeded")
        ) {
          parent.lastError = undefined;
          parent.state = "synced";
        }
        return [step];
      }
      if (name === "markStepFailed") {
        const [stepId, leaseToken, error, nextAttemptAt, reviewRequired, changedAt] =
          values as [string, string, string, string | undefined, boolean, string];
        const step = steps.find(
          (candidate) => candidate.id === stepId && candidate.leaseToken === leaseToken,
        );
        if (!step) return [];
        step.lastError = error;
        step.leaseExpiresAt = undefined;
        step.nextAttemptAt = nextAttemptAt;
        step.state = reviewRequired ? "review_required" : "retrying";
        step.updatedAt = changedAt;
        return [step];
      }
      if (name === "retryOperation" || name === "cancelOperation") {
        const [operationId, changedAt] = values as [string, string];
        const target = operations.find((operation) => operation.id === operationId);
        if (!target || (name === "retryOperation" && target.state !== "review_required")) {
          return [];
        }
        target.cancelledAt = name === "cancelOperation" ? changedAt : undefined;
        target.state = name === "retryOperation" ? "retrying" : "cancelled";
        target.updatedAt = changedAt;
        for (const step of steps.filter((step) => step.operationId === operationId)) {
          if (
            name === "retryOperation"
              ? step.state !== "review_required"
              : ["succeeded", "cancelled"].includes(step.state)
          ) {
            continue;
          }
          step.leaseExpiresAt = undefined;
          step.nextAttemptAt = name === "retryOperation" ? changedAt : undefined;
          step.state = name === "retryOperation" ? "retrying" : "cancelled";
          step.updatedAt = changedAt;
        }
        return [target];
      }
      if (name === "listOperations") return operations;
      if (name === "getHealth") return [...health.values()];
      if (name === "recordConnectorRead") {
        const [connector, succeeded, error, checkedAt] = values as [
          IntegrationConnectorHealth["connector"],
          boolean,
          string | undefined,
          string,
        ];
        const current = health.get(connector);
        health.set(connector, {
          connector,
          consecutiveFailures: succeeded ? 0 : (current?.consecutiveFailures ?? 0) + 1,
          lastCheckedAt: checkedAt,
          ...(succeeded ? { lastSuccessAt: checkedAt } : { lastError: error, lastFailureAt: checkedAt }),
          status: succeeded ? "healthy" : "degraded",
        });
        return [];
      }
      if (name === "appendAudit") {
        audits.push(values[0] as IntegrationAuditEvent);
        return [];
      }
      throw new Error(`Unexpected query: ${name}`);
    },
    async transaction(callback) {
      return callback(sql);
    },
  };

  return { audits, operations, sql, steps };
}

describe("integration repository", () => {
  it("creates a new operation and steps in declared order", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);

    const result = await repository.enqueue(operation());

    expect(result.replayed).toBe(false);
    expect(fake.operations).toHaveLength(1);
    expect(fake.steps.map((step) => [step.stepKey, step.stepOrder])).toEqual([
      ["msp.update", 0],
      ["push.notify", 1],
    ]);
  });

  it("replays an exact idempotent operation", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);

    await repository.enqueue(operation());

    await expect(repository.enqueue(operation())).resolves.toMatchObject({
      replayed: true,
    });
  });

  it("rejects idempotency key reuse for different work", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());

    await expect(
      repository.enqueue({ ...operation(), payload: { requestId: "other" } }),
    ).rejects.toThrow("already used for different work");
  });

  it("rejects idempotency key reuse when behavior-affecting input changes", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());

    await expect(
      repository.enqueue({ ...operation(), actorEmail: "other@example.com" }),
    ).rejects.toThrow("already used for different work");
    await expect(
      repository.enqueue({ ...operation(), requestId: "request-99" }),
    ).rejects.toThrow("already used for different work");
    await expect(
      repository.enqueue({ ...operation(), sourceVersion: "v2" }),
    ).rejects.toThrow("already used for different work");
    await expect(
      repository.enqueue({
        ...operation(),
        steps: [
          ...operation().steps,
          {
            action: "request.email",
            connector: "email",
            payload: { requestId: "42" },
            stepKey: "email.notify",
          },
        ],
      }),
    ).rejects.toThrow("already used for different work");
  });

  it("claims only due unfinished steps with a worker lease", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());
    fake.steps[1]!.state = "review_required";

    const [claimed] = await repository.claimDueSteps({
      leaseDurationMs: 60_000,
      now: new Date("2026-08-03T10:30:00.000Z"),
      workerId: "worker-a",
    });

    expect(claimed).toMatchObject({
      leaseExpiresAt: "2026-08-03T10:31:00.000Z",
      leaseToken: "lease-step-1",
      state: "processing",
      workerId: "worker-a",
    });
  });

  it("marks a leased step as succeeded", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());
    const [claimed] = await repository.claimDueSteps({ workerId: "worker-a" });

    await expect(
      repository.markStepSucceeded({
        leaseToken: claimed!.leaseToken!,
        result: { provider: "ok" },
        stepId: claimed!.id,
      }),
    ).resolves.toMatchObject({ result: { provider: "ok" }, state: "succeeded" });
  });

  it("clears stale step and operation errors when all steps succeed", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    const { operation: created } = await repository.enqueue(operation());
    fake.operations[0]!.lastError = "Previous failure";
    fake.steps[0]!.lastError = "Retry later";
    fake.steps[0]!.nextAttemptAt = "2026-08-03T10:00:00.000Z";
    fake.steps[1]!.state = "succeeded";
    const [claimed] = await repository.claimDueSteps({ workerId: "worker-a" });

    await repository.markStepSucceeded({
      leaseToken: claimed!.leaseToken!,
      result: { provider: "ok" },
      stepId: claimed!.id,
    });

    expect(fake.steps[0]).toMatchObject({
      lastError: undefined,
      nextAttemptAt: undefined,
      state: "succeeded",
    });
    expect(created).toMatchObject({ lastError: undefined, state: "synced" });
  });

  it("schedules a retryable failure", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());
    const [claimed] = await repository.claimDueSteps({ workerId: "worker-a" });

    await expect(
      repository.markStepFailed({
        error: "Temporary provider error",
        leaseToken: claimed!.leaseToken!,
        nextAttemptAt: new Date("2026-08-03T10:35:00.000Z"),
        stepId: claimed!.id,
      }),
    ).resolves.toMatchObject({
      nextAttemptAt: "2026-08-03T10:35:00.000Z",
      state: "retrying",
    });
  });

  it("marks a non-retryable failure for review", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());
    const [claimed] = await repository.claimDueSteps({ workerId: "worker-a" });

    await expect(
      repository.markStepFailed({
        error: "Needs operator review",
        leaseToken: claimed!.leaseToken!,
        reviewRequired: true,
        stepId: claimed!.id,
      }),
    ).resolves.toMatchObject({ state: "review_required" });
  });

  it("retries only review-required steps and cancels outstanding operation steps", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    const { operation: created } = await repository.enqueue(operation());
    created.state = "review_required";
    fake.steps[0]!.state = "review_required";
    fake.steps[1]!.state = "processing";
    fake.steps[1]!.leaseToken = "active-lease";

    await expect(repository.retryOperation(created.id)).resolves.toMatchObject({
      state: "retrying",
    });
    expect(fake.steps[0]).toMatchObject({ state: "retrying" });
    expect(fake.steps[1]).toMatchObject({
      leaseToken: "active-lease",
      state: "processing",
    });
    await expect(repository.cancelOperation(created.id)).resolves.toMatchObject({
      state: "cancelled",
    });
    expect(fake.steps[0]).toMatchObject({ state: "cancelled" });
  });

  it("rejects manual retry while an operation is processing or synced", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    const { operation: created } = await repository.enqueue(operation());

    created.state = "syncing";
    await expect(repository.retryOperation(created.id)).rejects.toThrow(
      "not ready for manual retry",
    );
    created.state = "synced";
    await expect(repository.retryOperation(created.id)).rejects.toThrow(
      "not ready for manual retry",
    );
  });

  it("claims only the next ordered step and stops after review is required", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    await repository.enqueue(operation());

    const first = await repository.claimDueSteps({ limit: 2, workerId: "worker-a" });
    expect(first.map((step) => step.stepOrder)).toEqual([0]);
    await repository.markStepFailed({
      error: "Needs review",
      leaseToken: first[0]!.leaseToken!,
      reviewRequired: true,
      stepId: first[0]!.id,
    });

    await expect(repository.claimDueSteps({ workerId: "worker-b" })).resolves.toEqual([]);
  });

  it("moves expired processing leases to review before claiming due work", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);
    const { operation: created } = await repository.enqueue(operation());
    fake.steps[0]!.leaseExpiresAt = "2026-08-03T10:00:00.000Z";
    fake.steps[0]!.leaseToken = "expired-lease";
    fake.steps[0]!.state = "processing";

    await expect(
      repository.claimDueSteps({
        now: new Date("2026-08-03T10:30:00.000Z"),
        workerId: "worker-a",
      }),
    ).resolves.toEqual([]);
    expect(fake.steps[0]).toMatchObject({ state: "review_required" });
    expect(created).toMatchObject({ state: "review_required" });
  });

  it("inserts only the bounded audit summary", async () => {
    const fake = fakeSql();
    const repository = createIntegrationRepository(fake.sql);

    const auditWithUnsafePayload = {
      attemptCount: 1,
      connector: "msp_central",
      durationMs: 235,
      errorCode: "HTTP_503",
      eventType: "connector.call",
      httpStatus: 503,
      outcome: "retrying",
      requestId: "request-42",
      stepKey: "msp.update",
      payload: { authorization: "do-not-store" },
    };
    await repository.appendAudit(auditWithUnsafePayload as IntegrationAuditEvent);

    expect(fake.audits).toEqual([
      {
        attemptCount: 1,
        connector: "msp_central",
        durationMs: 235,
        errorCode: "HTTP_503",
        eventType: "connector.call",
        httpStatus: 503,
        outcome: "retrying",
        requestId: "request-42",
        stepKey: "msp.update",
      },
    ]);
  });
});
