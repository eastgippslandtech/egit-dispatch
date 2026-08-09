import { describe, expect, it, vi } from "vitest";

import {
  AmbiguousIntegrationError,
  AuthenticationIntegrationError,
  PermanentIntegrationError,
  RetryableIntegrationError,
  classifyIntegrationError,
} from "./errors";
import { createIntegrationProcessor } from "./processor";
import type { IntegrationRepository } from "./repository";
import {
  createIntegrationAdapterRegistry,
  type IntegrationStepAdapter,
} from "./registry";
import type {
  IntegrationAuditEvent,
  IntegrationOperation,
  IntegrationOperationStep,
} from "./types";

const now = new Date("2026-08-03T00:00:00.000Z");

describe("classifyIntegrationError", () => {
  it.each([
    [Object.assign(new Error("socket reset"), { code: "ECONNRESET" }), "retryable"],
    [Object.assign(new Error("rate limited"), { status: 429 }), "retryable"],
    [Object.assign(new Error("provider unavailable"), { status: 503 }), "retryable"],
    [Object.assign(new Error("unauthorized"), { status: 401 }), "authentication_required"],
    [Object.assign(new Error("forbidden"), { status: 403 }), "authentication_required"],
    [Object.assign(new Error("invalid input"), { status: 400 }), "permanent"],
    [Object.assign(new Error("version conflict"), { status: 409 }), "conflict"],
  ])("classifies provider failures", (error, code) => {
    expect(
      classifyIntegrationError(error, { writeSafety: "idempotent" }).code,
    ).toBe(code);
  });

  it("treats an uncertain non-idempotent timeout as ambiguous", () => {
    const timeout = Object.assign(new Error("fetch timed out after write"), {
      code: "ETIMEDOUT",
    });

    expect(
      classifyIntegrationError(timeout, { writeSafety: "non_idempotent" }),
    ).toBeInstanceOf(AmbiguousIntegrationError);
  });

  it("keeps preflight retryable failures retryable for non-idempotent writes", () => {
    const oauthThrottle = new RetryableIntegrationError(
      "MSP Central OAuth refresh is temporarily throttled.",
      { safeToRetry: true },
    );

    const classified = classifyIntegrationError(oauthThrottle, {
      writeSafety: "non_idempotent",
    });

    expect(classified).toBeInstanceOf(RetryableIntegrationError);
    expect(classified.code).toBe("retryable");
  });

  it("preserves explicit integration error classes", () => {
    expect(
      classifyIntegrationError(new RetryableIntegrationError("again"), {
        writeSafety: "idempotent",
      }),
    ).toBeInstanceOf(RetryableIntegrationError);
    expect(
      classifyIntegrationError(new AuthenticationIntegrationError("reauthorize"), {
        writeSafety: "idempotent",
      }),
    ).toBeInstanceOf(AuthenticationIntegrationError);
    expect(
      classifyIntegrationError(new PermanentIntegrationError("invalid"), {
        writeSafety: "idempotent",
      }),
    ).toBeInstanceOf(PermanentIntegrationError);
  });
});

describe("integration processor", () => {
  it("rejects an adapter whose write safety is not declared", () => {
    expect(() =>
      createIntegrationAdapterRegistry({
        "outlook.unsafe": {
          execute: vi.fn(),
        } as unknown as IntegrationStepAdapter,
      }),
    ).toThrow("writeSafety");
  });

  it("records a successful result, connector health, and bounded audit event", async () => {
    const step = makeStep();
    const harness = createHarness([step]);
    const execute = vi.fn().mockResolvedValue({
      externalId: "event-123",
      externalVersion: "v4",
      summary: "Calendar event stored",
    });
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": { execute, writeSafety: "idempotent" },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await expect(processor.processDue({ limit: 10 })).resolves.toEqual({
      claimed: 1,
      processingErrors: 0,
      retrying: 0,
      reviewRequired: 0,
      succeeded: 1,
    });
    expect(execute).toHaveBeenCalledWith(step);
    expect(harness.succeeded).toEqual([
      {
        leaseToken: "lease-1",
        now,
        result: {
          externalId: "event-123",
          externalVersion: "v4",
          summary: "Calendar event stored",
        },
        stepId: "step-1",
      },
    ]);
    expect(harness.health).toContainEqual({
      connector: "outlook",
      now,
      status: "healthy",
      succeeded: true,
    });
    expect(harness.audit).toContainEqual({
      attemptCount: 1,
      connector: "outlook",
      durationMs: 0,
      eventType: "integration_step_succeeded",
      operationId: "operation-1",
      outcome: "succeeded",
      requestId: "REQ-100",
      stepKey: "outlook.primary",
    });
  });

  it.each([
    [1, 1],
    [2, 5],
    [3, 15],
    [4, 60],
    [5, 360],
    [8, 360],
  ])("uses the retry schedule for attempt %i", async (attemptCount, delayMinutes) => {
    const step = makeStep({ attemptCount });
    const harness = createHarness([step]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": {
          execute: vi.fn().mockRejectedValue(new RetryableIntegrationError("try again", 503)),
          writeSafety: "idempotent",
        },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    const result = await processor.processDue({ limit: 1 });

    expect(result.retrying).toBe(1);
    expect(harness.failed[0]).toEqual({
      error: "try again",
      leaseToken: "lease-1",
      nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000),
      now,
      reconciliationRequired: false,
      reviewRequired: false,
      stepId: "step-1",
    });
    expect(harness.health[0]).toMatchObject({
      status: "degraded",
      succeeded: false,
    });
  });

  it.each([
    [new AuthenticationIntegrationError("refresh token rejected", 401), "authentication_required", false],
    [new PermanentIntegrationError("validation failed", 400), undefined, false],
    [Object.assign(new Error("version conflict"), { status: 409 }), undefined, false],
    [new AmbiguousIntegrationError("write outcome unknown"), "degraded", true],
  ])("moves non-retryable failures to review", async (failure, healthStatus, reconciliationRequired) => {
    const harness = createHarness([makeStep()]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": {
          execute: vi.fn().mockRejectedValue(failure),
          writeSafety: "idempotent",
        },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    const result = await processor.processDue({ limit: 1 });

    expect(result.reviewRequired).toBe(1);
    expect(harness.failed[0]).toMatchObject({
      nextAttemptAt: undefined,
      reconciliationRequired,
      reviewRequired: true,
    });
    if (healthStatus) {
      expect(harness.health[0]).toMatchObject({
        status: healthStatus,
        succeeded: false,
      });
    } else {
      expect(harness.health).toEqual([]);
    }
  });

  it("never automatically retries a timeout from a non-idempotent adapter", async () => {
    const harness = createHarness([makeStep()]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": {
          execute: vi.fn().mockRejectedValue(
            Object.assign(new Error("timed out after sending"), { code: "ETIMEDOUT" }),
          ),
          writeSafety: "non_idempotent",
        },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await processor.processDue({ limit: 1 });

    expect(harness.failed[0]).toMatchObject({
      error: "timed out after sending",
      nextAttemptAt: undefined,
      reconciliationRequired: true,
      reviewRequired: true,
    });
    expect(harness.audit[0]).toMatchObject({ errorCode: "ambiguous" });
  });

  it("moves an unregistered action to review without crashing the batch", async () => {
    const harness = createHarness([makeStep({ action: "missing.action" })]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({}),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await expect(processor.processDue({ limit: 1 })).resolves.toMatchObject({
      processingErrors: 0,
      reviewRequired: 1,
    });
    expect(harness.failed[0]).toMatchObject({
      error: "No integration adapter is registered for missing.action.",
      reviewRequired: true,
    });
  });

  it("redacts credentials from persisted provider failure summaries", async () => {
    const harness = createHarness([makeStep()]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": {
          execute: vi.fn().mockRejectedValue(
            new RetryableIntegrationError(
              "Authorization: Bearer secret-token refresh_token=refresh-secret",
              503,
            ),
          ),
          writeSafety: "idempotent",
        },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await processor.processDue({ limit: 1 });

    expect(harness.failed[0]?.error).toBe(
      "Authorization: [REDACTED] refresh_token=[REDACTED]",
    );
    expect(harness.health[0]?.error).not.toContain("secret");
  });

  it("processes claimed steps in order and isolates failures within a batch", async () => {
    const executionOrder: string[] = [];
    const first = makeStep({ action: "msp.fail", stepKey: "msp.first" });
    const second = makeStep({
      action: "outlook.ok",
      connector: "outlook",
      id: "step-2",
      leaseToken: "lease-2",
      operationId: "operation-2",
      stepKey: "outlook.second",
    });
    const harness = createHarness([first, second]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "msp.fail": {
          execute: vi.fn(async () => {
            executionOrder.push("first");
            throw new PermanentIntegrationError("bad request", 400);
          }),
          writeSafety: "idempotent",
        },
        "outlook.ok": {
          execute: vi.fn(async () => {
            executionOrder.push("second");
            return { externalId: "event-2" };
          }),
          writeSafety: "idempotent",
        },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await expect(processor.processDue({ limit: 2 })).resolves.toMatchObject({
      claimed: 2,
      reviewRequired: 1,
      succeeded: 1,
    });
    expect(executionOrder).toEqual(["first", "second"]);
  });

  it("does not replay an expired lease that the repository moved to review", async () => {
    const harness = createHarness([]);
    const execute = vi.fn();
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": { execute, writeSafety: "idempotent" },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await expect(processor.processDue({ limit: 10 })).resolves.toEqual({
      claimed: 0,
      processingErrors: 0,
      retrying: 0,
      reviewRequired: 0,
      succeeded: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes a targeted operation id to the repository claim", async () => {
    const harness = createHarness([]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      registry: createIntegrationAdapterRegistry({}),
      repository: harness.repository,
      workerId: "worker-a",
    });

    await processor.processDue({ limit: 1, operationId: "operation-clicked" });

    expect(harness.repository.claimDueSteps).toHaveBeenCalledWith({
      limit: 1,
      now,
      operationId: "operation-clicked",
      workerId: "worker-a",
    });
  });

  it("continues the batch if persistence for one claimed step fails", async () => {
    const first = makeStep({ action: "outlook.first" });
    const second = makeStep({
      action: "outlook.second",
      id: "step-2",
      leaseToken: "lease-2",
      operationId: "operation-2",
      stepKey: "outlook.second",
    });
    const harness = createHarness([first, second]);
    harness.repository.markStepSucceeded = vi
      .fn()
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValueOnce(second);
    const secondExecute = vi.fn().mockResolvedValue({ externalId: "event-2" });
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.first": {
          execute: vi.fn().mockResolvedValue({ externalId: "event-1" }),
          writeSafety: "idempotent",
        },
        "outlook.second": {
          execute: secondExecute,
          writeSafety: "idempotent",
        },
      }),
      repository: harness.repository,
      workerId: "worker-a",
    });

    const result = await processor.processDue({ limit: 2 });

    expect(result.processingErrors).toBe(1);
    expect(secondExecute).toHaveBeenCalledOnce();
  });

  it("retries an idempotent provider step that exceeds its execution budget", async () => {
    const harness = createHarness([makeStep()]);
    const processor = createIntegrationProcessor({
      clock: () => now,
      jitter: (delay) => delay,
      registry: createIntegrationAdapterRegistry({
        "outlook.upsert": {
          execute: vi.fn(() => new Promise(() => undefined)),
          writeSafety: "idempotent",
        },
      }),
      repository: harness.repository,
      stepTimeoutMs: 1,
      workerId: "worker-a",
    });

    await expect(processor.processDue({ limit: 1 })).resolves.toMatchObject({
      retrying: 1,
      succeeded: 0,
    });
    expect(harness.failed[0]).toMatchObject({
      error: "Integration provider step timed out.",
      reconciliationRequired: false,
      reviewRequired: false,
    });
  });
});

function makeStep(
  overrides: Partial<IntegrationOperationStep> = {},
): IntegrationOperationStep {
  return {
    action: "outlook.upsert",
    attemptCount: 1,
    connector: "outlook",
    createdAt: now.toISOString(),
    id: "step-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    leaseToken: "lease-1",
    operationId: "operation-1",
    payload: { subject: "Example" },
    requiresReconciliation: false,
    startedAt: now.toISOString(),
    state: "processing",
    stepKey: "outlook.primary",
    stepOrder: 0,
    updatedAt: now.toISOString(),
    workerId: "worker-a",
    ...overrides,
  };
}

function makeOperation(id: string): IntegrationOperation {
  return {
    actionType: "schedule",
    actorEmail: "dispatcher@egit.com.au",
    attemptCount: 0,
    createdAt: now.toISOString(),
    id,
    idempotencyKey: `schedule:${id}`,
    inputFingerprint: "a".repeat(64),
    payload: {},
    requestId: id === "operation-1" ? "REQ-100" : "REQ-200",
    state: "syncing",
    updatedAt: now.toISOString(),
  };
}

function createHarness(claimed: IntegrationOperationStep[]) {
  const audit: IntegrationAuditEvent[] = [];
  const failed: Array<Record<string, unknown>> = [];
  const health: Array<
    Parameters<IntegrationRepository["recordConnectorRead"]>[0]
  > = [];
  const succeeded: Array<Record<string, unknown>> = [];
  const repository = {
    appendAudit: vi.fn(async (event: IntegrationAuditEvent) => {
      audit.push(event);
    }),
    claimDueSteps: vi.fn(async () => claimed),
    getOperation: vi.fn(async (operationId: string) => makeOperation(operationId)),
    markStepFailed: vi.fn(async (input: Record<string, unknown>) => {
      failed.push(input);
      return claimed.find((step) => step.id === input.stepId) ?? claimed[0];
    }),
    markStepSucceeded: vi.fn(async (input: Record<string, unknown>) => {
      succeeded.push(input);
      return claimed.find((step) => step.id === input.stepId) ?? claimed[0];
    }),
    recordConnectorRead: vi.fn(async (
      input: Parameters<IntegrationRepository["recordConnectorRead"]>[0],
    ) => {
      health.push(input);
    }),
  };
  return { audit, failed, health, repository, succeeded };
}
