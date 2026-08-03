import { describe, expect, it } from "vitest";

import {
  AmbiguousIntegrationError,
  AuthenticationIntegrationError,
  PermanentIntegrationError,
  RetryableIntegrationError,
} from "./errors";
import { mergeOperation, scheduleOperation, worklogOperation } from "./operations";
import { createIntegrationProcessor } from "./processor";
import {
  createIntegrationRepository,
  type IntegrationSql,
} from "./repository";
import {
  createIntegrationAdapterRegistry,
  type IntegrationStepAdapter,
} from "./registry";
import type {
  EnqueueIntegrationOperation,
  IntegrationAuditEvent,
  IntegrationConnector,
  IntegrationConnectorHealth,
  IntegrationOperation,
  IntegrationOperationStep,
} from "./types";

const START = new Date("2026-08-04T00:00:00.000Z");

describe("integration reliability end to end", () => {
  it("persists and completes a successful schedule", async () => {
    const harness = createDeterministicIntegrationHarness();

    const operation = await harness.enqueue(scheduleCommand());
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("synced");
    expect(harness.executionOrder).toEqual([
      "msp:schedule",
      "outlook:lead:tech-simeon",
      "command:link",
      "command:refresh",
    ]);
    expect(harness.health("msp_central")?.status).toBe("healthy");
    expect(harness.health("outlook")?.status).toBe("healthy");
  });

  it("does not repeat MSP Central after Graph retries", async () => {
    const harness = createDeterministicIntegrationHarness();
    let graphAttempts = 0;
    harness.on("outlook.upsert_event", async () => {
      graphAttempts += 1;
      if (graphAttempts === 1) {
        throw new RetryableIntegrationError("Graph temporarily unavailable", 503);
      }
      return { externalId: "event-42" };
    });

    const operation = await harness.enqueue(scheduleCommand());
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("retrying");
    expect(harness.executionCount("msp.schedule_request")).toBe(1);
    expect(graphAttempts).toBe(1);

    harness.advanceMinutes(2);
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("synced");
    expect(harness.executionCount("msp.schedule_request")).toBe(1);
    expect(graphAttempts).toBe(2);
  });

  it("does not repeat Graph when a later MSP Central step retries", async () => {
    const harness = createDeterministicIntegrationHarness();
    let mspAttempts = 0;
    harness.on("msp.schedule_request", async () => {
      mspAttempts += 1;
      if (mspAttempts === 1) {
        throw new RetryableIntegrationError("MSP Central unavailable", 503);
      }
      return {};
    });
    const command = operationCommand({
      actionType: "dispatch.reverse-order-verification",
      idempotencyKey: "schedule:reverse-order:1",
      requestId: "request-reverse",
      steps: [
        integrationStep("outlook", "outlook.upsert_event", "outlook:first"),
        integrationStep("msp_central", "msp.schedule_request", "msp:second"),
      ],
    });

    const operation = await harness.enqueue(command);
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("retrying");
    expect(harness.executionCount("outlook.upsert_event")).toBe(1);

    harness.advanceMinutes(2);
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("synced");
    expect(harness.executionCount("outlook.upsert_event")).toBe(1);
    expect(mspAttempts).toBe(2);
  });

  it("moves an ambiguous Work Log to review and never writes it twice", async () => {
    const harness = createDeterministicIntegrationHarness();
    let writes = 0;
    harness.on("msp.add_worklog", async (step) => {
      if (step.requiresReconciliation) {
        throw new AmbiguousIntegrationError(
          "The prior Work Log outcome cannot be proven.",
        );
      }
      writes += 1;
      throw new RetryableIntegrationError("Connection lost after send", 503);
    });

    const operation = await harness.enqueue(worklogCommand());
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("review_required");
    expect(harness.steps(operation.id)[0]).toMatchObject({
      requiresReconciliation: true,
      state: "review_required",
    });
    expect(writes).toBe(1);

    await harness.repository.retryOperationWithAudit({
      actorEmail: "simeon@egit.com.au",
      operationId: operation.id,
      now: harness.now(),
    });
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("review_required");
    expect(writes).toBe(1);
  });

  it("replays an exact command without inserting duplicate steps", async () => {
    const harness = createDeterministicIntegrationHarness();
    const command = scheduleCommand();

    const first = await harness.repository.enqueue(command);
    const replay = await harness.repository.enqueue(command);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.operation.id).toBe(first.operation.id);
    expect(harness.steps(first.operation.id)).toHaveLength(command.steps.length);
  });

  it("marks authentication expiry for operator review", async () => {
    const harness = createDeterministicIntegrationHarness();
    harness.on("msp.schedule_request", async () => {
      throw new AuthenticationIntegrationError("Refresh token rejected", 401);
    });

    const operation = await harness.enqueue(scheduleCommand());
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("review_required");
    expect(harness.health("msp_central")).toMatchObject({
      consecutiveFailures: 1,
      status: "authentication_required",
    });
  });

  it("moves an expired worker lease to review instead of replaying it", async () => {
    const harness = createDeterministicIntegrationHarness();
    const operation = await harness.enqueue(
      operationCommand({
        actionType: "worker.interruption",
        idempotencyKey: "worker-interruption:1",
        requestId: "request-interrupted",
        steps: [integrationStep("outlook", "outlook.upsert_event", "outlook:interrupted")],
      }),
    );
    const claimed = await harness.repository.claimDueSteps({
      limit: 1,
      now: harness.now(),
      workerId: "crashed-worker",
    });
    expect(claimed).toHaveLength(1);

    harness.advanceMinutes(2);
    const result = await harness.processor.processDue({ limit: 10 });

    expect(result.claimed).toBe(0);
    expect(harness.operation(operation.id).state).toBe("review_required");
    expect(harness.steps(operation.id)[0]).toMatchObject({
      requiresReconciliation: true,
      state: "review_required",
    });
    expect(harness.executionCount("outlook.upsert_event")).toBe(0);
  });

  it("refreshes both the surviving and merged request after a merge", async () => {
    const harness = createDeterministicIntegrationHarness();
    const command = mergeOperation({
      actorEmail: "simeon@egit.com.au",
      childRequestId: "duplicate-42",
      idempotencyKey: "merge:duplicate-42:parent-7",
      parentRequestId: "parent-7",
    });

    const operation = await harness.enqueue(command);
    await harness.drain();

    expect(harness.operation(operation.id).state).toBe("synced");
    expect(harness.executionOrder).toEqual(["msp:merge", "command:refresh"]);
    expect(harness.executedStep("command:refresh")?.payload).toMatchObject({
      relatedRequestIds: ["duplicate-42", "parent-7"],
    });
  });

  it("supports audited manual Retry and safe Cancel", async () => {
    const harness = createDeterministicIntegrationHarness();
    let remediated = false;
    harness.on("msp.schedule_request", async () => {
      if (!remediated) throw new PermanentIntegrationError("Invalid mapping", 400);
      return {};
    });
    const retryTarget = await harness.enqueue(scheduleCommand());
    await harness.drain();
    remediated = true;

    await harness.repository.retryOperationWithAudit({
      actorEmail: "dispatcher@egit.com.au",
      operationId: retryTarget.id,
      now: harness.now(),
    });
    await harness.drain();

    expect(harness.operation(retryTarget.id).state).toBe("synced");
    expect(harness.audit).toContainEqual(
      expect.objectContaining({
        actorEmail: "dispatcher@egit.com.au",
        operatorAction: "retry",
      }),
    );

    const cancelTarget = await harness.enqueue(
      operationCommand({
        actionType: "dispatch.cancel-verification",
        idempotencyKey: "cancel-verification:1",
        requestId: "request-cancelled",
        steps: [integrationStep("outlook", "outlook.upsert_event", "outlook:cancelled")],
      }),
    );
    await harness.repository.cancelOperationWithAudit({
      actorEmail: "dispatcher@egit.com.au",
      operationId: cancelTarget.id,
      now: harness.now(),
    });
    await harness.drain();

    expect(harness.operation(cancelTarget.id).state).toBe("cancelled");
    expect(harness.executionOrder).not.toContain("outlook:cancelled");
    expect(harness.audit).toContainEqual(
      expect.objectContaining({
        actorEmail: "dispatcher@egit.com.au",
        operatorAction: "cancel",
      }),
    );
  });
});

type StepHandler = (
  step: IntegrationOperationStep,
) => Promise<Record<string, unknown>>;

function createDeterministicIntegrationHarness() {
  const sql = new FakeIntegrationSql(START);
  const repository = createIntegrationRepository(sql);
  const handlers = new Map<string, StepHandler>();
  const executionOrder: string[] = [];
  const executedSteps: IntegrationOperationStep[] = [];
  let current = new Date(START);
  const actions = [
    "command_centre.invalidate_request",
    "command_centre.persist_dispatch_link",
    "msp.add_worklog",
    "msp.merge_requests",
    "msp.schedule_request",
    "outlook.upsert_event",
  ];
  const nonIdempotent = new Set(["msp.add_worklog", "msp.merge_requests"]);
  const adapters = Object.fromEntries(
    actions.map((action) => [
      action,
      {
        async execute(step: IntegrationOperationStep) {
          executionOrder.push(step.stepKey);
          executedSteps.push(structuredClone(step));
          return (await handlers.get(action)?.(step)) ?? {};
        },
        writeSafety: nonIdempotent.has(action)
          ? "non_idempotent"
          : "idempotent",
      } satisfies IntegrationStepAdapter,
    ]),
  );
  const processor = createIntegrationProcessor({
    clock: () => new Date(current),
    jitter: (delay) => delay,
    registry: createIntegrationAdapterRegistry(adapters),
    repository,
    workerId: "test-worker",
  });

  return {
    audit: sql.audit,
    executionOrder,
    processor,
    repository,
    advanceMinutes(minutes: number) {
      current = new Date(current.getTime() + minutes * 60_000);
    },
    async drain() {
      for (let index = 0; index < 30; index += 1) {
        const result = await processor.processDue({ limit: 20 });
        if (result.claimed === 0) return;
      }
      throw new Error("Deterministic integration worker did not drain.");
    },
    async enqueue(command: EnqueueIntegrationOperation) {
      return (await repository.enqueue(command)).operation;
    },
    executedStep(stepKey: string) {
      return executedSteps.find((step) => step.stepKey === stepKey);
    },
    executionCount(action: string) {
      return executedSteps.filter((step) => step.action === action).length;
    },
    health(connector: IntegrationConnector) {
      return sql.health.get(connector);
    },
    now() {
      return new Date(current);
    },
    on(action: string, handler: StepHandler) {
      handlers.set(action, handler);
    },
    operation(operationId: string) {
      return required(sql.operations.get(operationId), "Operation missing from fake SQL.");
    },
    steps(operationId: string) {
      return [...sql.steps.values()]
        .filter((step) => step.operationId === operationId)
        .sort((left, right) => left.stepOrder - right.stepOrder);
    },
  };
}

class FakeIntegrationSql implements IntegrationSql {
  readonly audit: IntegrationAuditEvent[] = [];
  readonly health = new Map<IntegrationConnector, IntegrationConnectorHealth>();
  readonly operations = new Map<string, IntegrationOperation>();
  readonly steps = new Map<string, IntegrationOperationStep>();
  private operationSequence = 0;
  private stepSequence = 0;
  private leaseSequence = 0;

  constructor(private readonly createdAt: Date) {}

  async query(
    name: Parameters<IntegrationSql["query"]>[0],
    values: readonly unknown[],
  ): Promise<unknown[]> {
    if (name === "findOperationByKey") {
      return [...this.operations.values()].filter(
        (operation) => operation.idempotencyKey === values[0],
      );
    }
    if (name === "insertOperation") {
      const [input, inputFingerprint, actorEmail] = values as [
        EnqueueIntegrationOperation,
        string,
        string,
      ];
      if ([...this.operations.values()].some(
        (operation) => operation.idempotencyKey === input.idempotencyKey,
      )) return [];
      const timestamp = this.createdAt.toISOString();
      const operation: IntegrationOperation = {
        actionType: input.actionType,
        actorEmail,
        attemptCount: 0,
        createdAt: timestamp,
        id: `operation-${++this.operationSequence}`,
        idempotencyKey: input.idempotencyKey,
        inputFingerprint,
        payload: structuredClone(input.payload),
        requestId: input.requestId ?? input.idempotencyKey,
        ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}),
        state: "queued",
        updatedAt: timestamp,
      };
      this.operations.set(operation.id, operation);
      return [operation];
    }
    if (name === "insertStep") {
      const [operationId, input, stepOrder] = values as [
        string,
        EnqueueIntegrationOperation["steps"][number],
        number,
      ];
      const timestamp = this.createdAt.toISOString();
      const step: IntegrationOperationStep = {
        action: input.action,
        attemptCount: 0,
        connector: input.connector,
        createdAt: timestamp,
        id: `step-${++this.stepSequence}`,
        operationId,
        payload: structuredClone(input.payload),
        requiresReconciliation: false,
        state: "queued",
        stepKey: input.stepKey,
        stepOrder,
        updatedAt: timestamp,
      };
      this.steps.set(step.id, step);
      return [step];
    }
    if (name === "expireExpiredLeases") {
      const changedAt = String(values[0]);
      for (const step of this.steps.values()) {
        if (
          step.state === "processing" &&
          step.leaseExpiresAt &&
          step.leaseExpiresAt <= changedAt
        ) {
          Object.assign(step, {
            lastError: step.lastError ?? "Integration step lease expired before completion.",
            leaseExpiresAt: undefined,
            leaseToken: undefined,
            nextAttemptAt: undefined,
            requiresReconciliation: true,
            state: "review_required",
            updatedAt: changedAt,
            workerId: undefined,
          });
          const operation = required(this.operations.get(step.operationId), "Operation missing.");
          Object.assign(operation, {
            lastError: operation.lastError ?? "Integration step lease expired before completion.",
            state: "review_required",
            updatedAt: changedAt,
          });
        }
      }
      return [];
    }
    if (name === "claimDueSteps") {
      const [now, workerId, leaseExpiresAt, limit] = values as [
        string,
        string,
        string,
        number,
      ];
      const due = [...this.steps.values()]
        .filter((step) => {
          const operation = required(this.operations.get(step.operationId), "Operation missing.");
          const predecessors = [...this.steps.values()].filter(
            (candidate) =>
              candidate.operationId === step.operationId &&
              candidate.stepOrder < step.stepOrder,
          );
          return (
            (step.state === "queued" || step.state === "retrying") &&
            operation.state !== "review_required" &&
            operation.state !== "cancelled" &&
            operation.state !== "synced" &&
            (!step.nextAttemptAt || step.nextAttemptAt <= now) &&
            predecessors.every((predecessor) => predecessor.state === "succeeded")
          );
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.stepOrder - right.stepOrder)
        .slice(0, limit);
      for (const step of due) {
        Object.assign(step, {
          attemptCount: step.attemptCount + 1,
          leaseExpiresAt,
          leaseToken: `lease-${++this.leaseSequence}`,
          startedAt: step.startedAt ?? now,
          state: "processing",
          updatedAt: now,
          workerId,
        });
        const operation = required(this.operations.get(step.operationId), "Operation missing.");
        operation.state = "syncing";
        operation.updatedAt = now;
      }
      return due.map((step) => structuredClone(step));
    }
    if (name === "markStepSucceeded") {
      const [stepId, leaseToken, result, completedAt] = values as [
        string,
        string,
        Record<string, unknown>,
        string,
      ];
      const step = this.leasedStep(stepId, leaseToken);
      if (!step) return [];
      Object.assign(step, {
        completedAt,
        lastError: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        nextAttemptAt: undefined,
        requiresReconciliation: false,
        result: structuredClone(result),
        state: "succeeded",
        updatedAt: completedAt,
        workerId: undefined,
      });
      const operation = required(this.operations.get(step.operationId), "Operation missing.");
      const allSucceeded = [...this.steps.values()]
        .filter((candidate) => candidate.operationId === step.operationId)
        .every((candidate) => candidate.state === "succeeded");
      if (allSucceeded) {
        operation.state = "synced";
        operation.syncedAt = completedAt;
        operation.lastError = undefined;
      }
      operation.updatedAt = completedAt;
      return [structuredClone(step)];
    }
    if (name === "markStepFailed") {
      const [stepId, leaseToken, error, nextAttemptAt, reconciliationRequired, reviewRequired, changedAt] = values as [
        string,
        string,
        string,
        string | undefined,
        boolean,
        boolean,
        string,
      ];
      const step = this.leasedStep(stepId, leaseToken);
      if (!step) return [];
      Object.assign(step, {
        lastError: error,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        nextAttemptAt,
        requiresReconciliation: step.requiresReconciliation || reconciliationRequired,
        state: reviewRequired ? "review_required" : "retrying",
        updatedAt: changedAt,
        workerId: undefined,
      });
      const operation = required(this.operations.get(step.operationId), "Operation missing.");
      operation.state = reviewRequired ? "review_required" : "retrying";
      operation.lastError = error;
      operation.updatedAt = changedAt;
      return [structuredClone(step)];
    }
    if (name === "getOperation") {
      const operation = this.operations.get(String(values[0]));
      return operation ? [structuredClone(operation)] : [];
    }
    if (name === "retryOperation") {
      const [operationId, changedAt] = values as [string, string];
      const operation = this.operations.get(operationId);
      if (!operation || operation.state !== "review_required") return [];
      operation.state = "retrying";
      operation.attemptCount += 1;
      operation.lastError = undefined;
      operation.updatedAt = changedAt;
      for (const step of this.steps.values()) {
        if (step.operationId === operationId && step.state === "review_required") {
          step.state = "retrying";
          step.nextAttemptAt = changedAt;
          step.updatedAt = changedAt;
        }
      }
      return [structuredClone(operation)];
    }
    if (name === "cancelOperation") {
      const [operationId, changedAt] = values as [string, string];
      const operation = this.operations.get(operationId);
      const related = [...this.steps.values()].filter((step) => step.operationId === operationId);
      if (
        !operation ||
        !["queued", "retrying", "review_required"].includes(operation.state) ||
        related.some((step) => step.state === "processing" || step.leaseToken)
      ) return [];
      operation.state = "cancelled";
      operation.cancelledAt = changedAt;
      operation.updatedAt = changedAt;
      for (const step of related) {
        if (["queued", "retrying", "review_required"].includes(step.state)) {
          step.state = "cancelled";
          step.nextAttemptAt = undefined;
          step.updatedAt = changedAt;
        }
      }
      return [structuredClone(operation)];
    }
    if (name === "appendAudit") {
      this.audit.push(structuredClone(values[0] as IntegrationAuditEvent));
      return [];
    }
    if (name === "recordConnectorRead" || name === "recordConnectorWrite") {
      const [connector, succeeded, error, checkedAt, requestedStatus] = values as [
        IntegrationConnector,
        boolean,
        string | undefined,
        string,
        IntegrationConnectorHealth["status"] | undefined,
      ];
      const previous = this.health.get(connector);
      this.health.set(connector, {
        connector,
        consecutiveFailures: succeeded ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
        lastCheckedAt: checkedAt,
        lastError: succeeded ? undefined : error,
        lastFailureAt: succeeded ? previous?.lastFailureAt : checkedAt,
        lastReadAt: name === "recordConnectorRead" ? checkedAt : previous?.lastReadAt,
        lastSuccessAt: succeeded ? checkedAt : previous?.lastSuccessAt,
        lastWriteAt: name === "recordConnectorWrite" ? checkedAt : previous?.lastWriteAt,
        status: requestedStatus ?? (succeeded ? "healthy" : "degraded"),
      });
      return [];
    }
    if (name === "getStepResults") {
      return [...this.steps.values()]
        .filter((step) => step.operationId === values[0] && step.result)
        .map((step) => ({ result: step.result, stepKey: step.stepKey }));
    }
    throw new Error(`Fake integration SQL does not implement ${name}.`);
  }

  async transaction<T>(callback: (transaction: IntegrationSql) => Promise<T>) {
    return callback(this);
  }

  private leasedStep(stepId: string, leaseToken: string) {
    const step = this.steps.get(stepId);
    return step?.state === "processing" && step.leaseToken === leaseToken
      ? step
      : undefined;
  }
}

function scheduleCommand() {
  return scheduleOperation({
    actorEmail: "simeon@egit.com.au",
    appointmentId: "appointment-42",
    bookingType: "Remote",
    customer: "Example Co",
    date: "2026-08-04",
    end: "11:00",
    idempotencyKey: "schedule:request-42:v1",
    lead: {
      mspCentralTechnicianId: "msp-simeon",
      technicianEmail: "simeon@egit.com.au",
      technicianId: "tech-simeon",
      technicianName: "Simeon",
      userPrincipalName: "simeon@egit.com.au",
    },
    location: "Remote / Virtual",
    requestId: "request-42",
    requestNumber: "REQ-42",
    start: "10:00",
    subject: "Printer offline",
  });
}

function worklogCommand() {
  return worklogOperation({
    actorEmail: "simeon@egit.com.au",
    command: {
      description: "Completed diagnostics.",
      durationMinutes: 15,
      endedAt: "2026-08-04T10:15:00+10:00",
      idempotencyKey: "worklog:request-42:timer-1",
      requestId: "request-42",
      scheduled: false,
      startedAt: "2026-08-04T10:00:00+10:00",
      visibility: "internal",
      workType: "internal",
    },
    ownerId: "msp-simeon",
  });
}

function operationCommand({
  actionType,
  idempotencyKey,
  requestId,
  steps,
}: Pick<EnqueueIntegrationOperation, "actionType" | "idempotencyKey" | "requestId" | "steps">): EnqueueIntegrationOperation {
  return {
    actionType,
    actorEmail: "simeon@egit.com.au",
    idempotencyKey,
    payload: { requestId },
    requestId,
    steps,
  };
}

function integrationStep(
  connector: IntegrationConnector,
  action: string,
  stepKey: string,
) {
  return { action, connector, payload: { requestId: "request-42" }, stepKey };
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
