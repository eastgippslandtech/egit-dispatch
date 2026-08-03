import {
  classifyIntegrationError,
  type ClassifiedIntegrationError,
} from "./errors";
import type { IntegrationRepository } from "./repository";
import type { IntegrationAdapterRegistry } from "./registry";
import type { IntegrationOperationStep } from "./types";

const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360] as const;

type ProcessorRepository = Pick<
  IntegrationRepository,
  | "appendAudit"
  | "claimDueSteps"
  | "getOperation"
  | "markStepFailed"
  | "markStepSucceeded"
  | "recordConnectorRead"
> &
  Partial<Pick<IntegrationRepository, "recordConnectorWrite">>;

export function createIntegrationProcessor({
  clock = () => new Date(),
  jitter = defaultJitter,
  registry,
  repository,
  workerId,
}: {
  clock?: () => Date;
  jitter?: (delayMs: number, step: IntegrationOperationStep) => number;
  registry: IntegrationAdapterRegistry;
  repository: ProcessorRepository;
  workerId: string;
}) {
  return {
    async processDue({ limit = 10 }: { limit?: number } = {}) {
      const claimed = await repository.claimDueSteps({
        limit,
        now: clock(),
        workerId,
      });
      const summary = {
        claimed: claimed.length,
        processingErrors: 0,
        retrying: 0,
        reviewRequired: 0,
        succeeded: 0,
      };

      for (const step of claimed) {
        try {
          const outcome = await processStep(step);
          summary[outcome] += 1;
        } catch {
          // A persistence or audit outage on one lease must not prevent unrelated work.
          summary.processingErrors += 1;
        }
      }

      return summary;
    },
  };

  async function processStep(
    step: IntegrationOperationStep,
  ): Promise<"retrying" | "reviewRequired" | "succeeded"> {
    const startedAt = clock();
    const operation = await repository.getOperation(step.operationId);
    let adapter;
    try {
      adapter = registry.get(step.action);
    } catch (error) {
      const failure = classifyIntegrationError(error, {
        writeSafety: "non_idempotent",
      });
      return handleFailure(step, operation.requestId, failure, startedAt);
    }

    let result;
    try {
      result = await adapter.execute(step);
    } catch (error) {
      const failure = classifyIntegrationError(error, {
        writeSafety: adapter.writeSafety,
      });
      return handleFailure(step, operation.requestId, failure, startedAt);
    }

    const completedAt = clock();
    await repository.markStepSucceeded({
      leaseToken: requiredLeaseToken(step),
      now: completedAt,
      result,
      stepId: step.id,
    });
    await recordConnectorWrite({
      connector: step.connector,
      now: completedAt,
      status: "healthy",
      succeeded: true,
    });
    await repository.appendAudit({
      attemptCount: step.attemptCount,
      connector: step.connector,
      durationMs: elapsedMilliseconds(startedAt, completedAt),
      eventType: "integration_step_succeeded",
      operationId: step.operationId,
      outcome: "succeeded",
      requestId: operation.requestId,
      stepKey: step.stepKey,
    });
    return "succeeded";
  }

  async function handleFailure(
    step: IntegrationOperationStep,
    requestId: string,
    failure: ClassifiedIntegrationError,
    startedAt: Date,
  ): Promise<"retrying" | "reviewRequired"> {
    const failedAt = clock();
    const retrying = failure.code === "retryable";
    const failureSummary = safeFailureSummary(failure.message);
    const nextAttemptAt = retrying
      ? new Date(
          failedAt.getTime() +
            boundedJitter(jitter(retryDelayMs(step.attemptCount), step)),
        )
      : undefined;

    await repository.markStepFailed({
      error: failureSummary,
      leaseToken: requiredLeaseToken(step),
      nextAttemptAt,
      now: failedAt,
      reconciliationRequired: failure.code === "ambiguous",
      reviewRequired: !retrying,
      stepId: step.id,
    });
    if (affectsConnectorHealth(failure)) {
      await recordConnectorWrite({
        connector: step.connector,
        error: failureSummary,
        now: failedAt,
        status:
          failure.code === "authentication_required"
            ? "authentication_required"
            : "degraded",
        succeeded: false,
      });
    }
    await repository.appendAudit({
      attemptCount: step.attemptCount,
      connector: step.connector,
      durationMs: elapsedMilliseconds(startedAt, failedAt),
      errorCode: failure.code,
      eventType: retrying
        ? "integration_step_retry_scheduled"
        : "integration_step_review_required",
      ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
      operationId: step.operationId,
      outcome: retrying ? "retrying" : "review_required",
      requestId,
      stepKey: step.stepKey,
    });
    return retrying ? "retrying" : "reviewRequired";
  }

  function recordConnectorWrite(
    input: Parameters<IntegrationRepository["recordConnectorWrite"]>[0],
  ) {
    return (repository.recordConnectorWrite ?? repository.recordConnectorRead)(
      input,
    );
  }
}

function retryDelayMs(attemptCount: number) {
  const index = Math.min(
    Math.max(Math.trunc(attemptCount), 1) - 1,
    RETRY_DELAYS_MINUTES.length - 1,
  );
  return RETRY_DELAYS_MINUTES[index] * 60_000;
}

function defaultJitter(delayMs: number) {
  return Math.round(delayMs * (0.9 + Math.random() * 0.2));
}

function boundedJitter(delayMs: number) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Integration retry jitter must return a non-negative delay.");
  }
  return Math.round(delayMs);
}

function requiredLeaseToken(step: IntegrationOperationStep) {
  if (!step.leaseToken) {
    throw new Error("Claimed integration step is missing its lease token.");
  }
  return step.leaseToken;
}

function elapsedMilliseconds(startedAt: Date, finishedAt: Date) {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

function safeFailureSummary(message: string) {
  return message
    .replace(
      /authorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(
      /\b(access_token|refresh_token|client_secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function affectsConnectorHealth(failure: ClassifiedIntegrationError) {
  return failure.code !== "permanent" && failure.code !== "conflict";
}
