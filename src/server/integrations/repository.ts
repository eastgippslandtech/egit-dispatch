import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import { fingerprintPayload } from "./fingerprint";
import type {
  EnqueueIntegrationOperation,
  IntegrationAuditEvent,
  IntegrationConnector,
  IntegrationConnectorHealth,
  IntegrationConnectorHealthStatus,
  IntegrationOperation,
  IntegrationOperationStep,
} from "./types";

type IntegrationQueryName =
  | "appendAudit"
  | "cancelOperation"
  | "claimDueSteps"
  | "expireExpiredLeases"
  | "findOperationByKey"
  | "getOperation"
  | "getHealth"
  | "insertOperation"
  | "insertStep"
  | "listOperations"
  | "markStepFailed"
  | "markStepSucceeded"
  | "recordConnectorRead"
  | "retryOperation";

export type IntegrationSql = {
  query(name: IntegrationQueryName, values: readonly unknown[]): Promise<unknown[]>;
  transaction<T>(callback: (transaction: IntegrationSql) => Promise<T>): Promise<T>;
};

export type IntegrationRepository = ReturnType<typeof createIntegrationRepository>;

export function createIntegrationRepository(sql: IntegrationSql) {
  return {
    async appendAudit(input: IntegrationAuditEvent) {
      await sql.query("appendAudit", [sanitizeAuditEvent(input)]);
    },

    async cancelOperation(operationId: string, now = new Date()) {
      return requiredRow<IntegrationOperation>(
        await sql.query("cancelOperation", [operationId, now.toISOString()]),
        "Integration operation was not found.",
      );
    },

    async claimDueSteps({
      leaseDurationMs = 60_000,
      limit = 10,
      now = new Date(),
      workerId,
    }: {
      leaseDurationMs?: number;
      limit?: number;
      now?: Date;
      workerId: string;
    }): Promise<IntegrationOperationStep[]> {
      const claimedAt = now.toISOString();
      return sql.transaction(async (transaction) => {
        await transaction.query("expireExpiredLeases", [claimedAt]);
        return (await transaction.query("claimDueSteps", [
          claimedAt,
          boundedWorkerId(workerId),
          new Date(now.getTime() + leaseDurationMs).toISOString(),
          limit,
        ])) as IntegrationOperationStep[];
      });
    },

    async enqueue(input: EnqueueIntegrationOperation) {
      const inputFingerprint = fingerprintOperationInput(input);
      const actorEmail = normalizeEmail(input.actorEmail);
      return sql.transaction(async (transaction) => {
        const existing = (await transaction.query("findOperationByKey", [
          input.idempotencyKey,
        ])) as IntegrationOperation[];
        if (existing[0]) {
          assertMatchingInput(existing[0], inputFingerprint);
          return { operation: existing[0], replayed: true };
        }

        const inserted = (await transaction.query("insertOperation", [
          input,
          inputFingerprint,
          actorEmail,
        ])) as IntegrationOperation[];
        const operation = inserted[0];
        if (!operation) {
          const conflicted = (await transaction.query("findOperationByKey", [
            input.idempotencyKey,
          ])) as IntegrationOperation[];
          const replay = requiredRow<IntegrationOperation>(
            conflicted,
            "Integration operation could not be stored.",
          );
          assertMatchingInput(replay, inputFingerprint);
          return { operation: replay, replayed: true };
        }

        for (const [stepOrder, step] of input.steps.entries()) {
          await transaction.query("insertStep", [operation.id, step, stepOrder]);
        }
        return { operation, replayed: false };
      });
    },

    async getHealth(): Promise<IntegrationConnectorHealth[]> {
      return (await sql.query("getHealth", [])) as IntegrationConnectorHealth[];
    },

    async getOperation(operationId: string) {
      return requiredRow<IntegrationOperation>(
        await sql.query("getOperation", [operationId]),
        "Integration operation was not found.",
      );
    },

    async listOperations({ limit = 50 }: { limit?: number } = {}) {
      return (await sql.query("listOperations", [limit])) as IntegrationOperation[];
    },

    async markStepFailed({
      error,
      leaseToken,
      nextAttemptAt,
      now = new Date(),
      reviewRequired = false,
      stepId,
    }: {
      error: string;
      leaseToken: string;
      nextAttemptAt?: Date;
      now?: Date;
      reviewRequired?: boolean;
      stepId: string;
    }) {
      return requiredRow<IntegrationOperationStep>(
        await sql.query("markStepFailed", [
          stepId,
          leaseToken,
          safeError(error),
          nextAttemptAt?.toISOString(),
          reviewRequired,
          now.toISOString(),
        ]),
        "Integration step lease was not found.",
      );
    },

    async markStepSucceeded({
      leaseToken,
      now = new Date(),
      result,
      stepId,
    }: {
      leaseToken: string;
      now?: Date;
      result: Record<string, unknown>;
      stepId: string;
    }) {
      return requiredRow<IntegrationOperationStep>(
        await sql.query("markStepSucceeded", [
          stepId,
          leaseToken,
          result,
          now.toISOString(),
        ]),
        "Integration step lease was not found.",
      );
    },

    async recordConnectorRead({
      connector,
      error,
      now = new Date(),
      status,
      succeeded,
    }: {
      connector: IntegrationConnector;
      error?: string;
      now?: Date;
      status?: IntegrationConnectorHealthStatus;
      succeeded: boolean;
    }) {
      await sql.query("recordConnectorRead", [
        connector,
        succeeded,
        error ? safeError(error) : undefined,
        now.toISOString(),
        status,
      ]);
    },

    async retryOperation(operationId: string, now = new Date()) {
      return requiredRow<IntegrationOperation>(
        await sql.query("retryOperation", [operationId, now.toISOString()]),
        "Integration operation is not ready for manual retry.",
      );
    },
  };
}

export function createPostgresIntegrationRepository({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): IntegrationRepository {
  return createIntegrationRepository(new PostgresIntegrationSql(sql));
}

class PostgresIntegrationSql implements IntegrationSql {
  constructor(private readonly sql: postgres.Sql) {}

  async query(
    name: IntegrationQueryName,
    values: readonly unknown[],
  ): Promise<unknown[]> {
    switch (name) {
      case "findOperationByKey": {
        const [idempotencyKey] = values as [string];
        return this.operations(
          this.sql`
            select ${this.sql.unsafe(operationColumns)}
            from public.integration_operations
            where idempotency_key = ${idempotencyKey}
            limit 1
          `,
        );
      }
      case "insertOperation": {
        const [input, inputFingerprint, actorEmail] = values as [
          EnqueueIntegrationOperation,
          string,
          string,
        ];
        return this.operations(
          this.sql`
            insert into public.integration_operations (
              idempotency_key,
              request_id,
              action,
              actor_email,
              source_version,
              input_fingerprint,
              payload
            ) values (
              ${input.idempotencyKey},
              ${input.requestId ?? input.idempotencyKey},
              ${input.actionType},
              ${actorEmail},
              ${input.sourceVersion ?? null},
              ${inputFingerprint},
              ${this.sql.json(input.payload as postgres.JSONValue)}
            )
            on conflict (idempotency_key) do nothing
            returning ${this.sql.unsafe(operationColumns)}
          `,
        );
      }
      case "insertStep": {
        const [operationId, step, stepOrder] = values as [
          string,
          EnqueueIntegrationOperation["steps"][number],
          number,
        ];
        return this.steps(
          this.sql`
            insert into public.integration_operation_steps (
              operation_id,
              step_key,
              step_order,
              connector,
              action,
              payload
            ) values (
              ${operationId},
              ${step.stepKey},
              ${stepOrder},
              ${step.connector},
              ${step.action},
              ${this.sql.json(step.payload as postgres.JSONValue)}
            )
            returning ${this.sql.unsafe(stepColumns)}
          `,
        );
      }
      case "claimDueSteps": {
        const [now, workerId, leaseExpiresAt, limit] = values as [
          string,
          string,
          string,
          number,
        ];
        return this.steps(
          this.sql`
            with due as (
              select step.id
              from public.integration_operation_steps step
              join public.integration_operations operation
                on operation.id = step.operation_id
              where step.state in ('queued', 'retrying')
                and operation.state not in ('review_required', 'cancelled', 'synced')
                and (step.next_attempt_at is null or step.next_attempt_at <= ${now})
                and not exists (
                  select 1
                  from public.integration_operation_steps predecessor
                  where predecessor.operation_id = step.operation_id
                    and predecessor.step_order < step.step_order
                    and predecessor.state <> 'succeeded'
                )
              order by step.next_attempt_at nulls first, step.created_at
              for update of step skip locked
              limit ${limit}
            ), claimed as (
              update public.integration_operation_steps step
              set
                state = 'processing',
                attempt_count = step.attempt_count + 1,
                lease_token = gen_random_uuid(),
                worker_id = ${workerId},
                leased_at = ${now},
                lease_expires_at = ${leaseExpiresAt},
                started_at = coalesce(step.started_at, ${now}),
                updated_at = ${now}
              from due
              where step.id = due.id
              returning step.*
            ), parents as (
              update public.integration_operations operation
              set
                state = 'syncing',
                updated_at = ${now}
              where operation.id in (select operation_id from claimed)
                and operation.state in ('queued', 'retrying', 'syncing')
              returning operation.id
            )
            select ${this.sql.unsafe(stepColumnsFromClaimed)}
            from claimed
          `,
        );
      }
      case "expireExpiredLeases": {
        const [changedAt] = values as [string];
        await this.sql`
          with expired as (
            update public.integration_operation_steps
            set
              state = 'review_required',
              next_attempt_at = null,
              lease_token = null,
              worker_id = null,
              leased_at = null,
              lease_expires_at = null,
              last_error = coalesce(last_error, 'Integration step lease expired before completion.'),
              updated_at = ${changedAt}
            where state = 'processing'
              and lease_expires_at is not null
              and lease_expires_at <= ${changedAt}
            returning operation_id
          )
          update public.integration_operations operation
          set
            state = 'review_required',
            last_error = coalesce(operation.last_error, 'Integration step lease expired before completion.'),
            updated_at = ${changedAt}
          where operation.id in (select distinct operation_id from expired)
            and operation.state not in ('cancelled', 'synced')
        `;
        return [];
      }
      case "markStepSucceeded": {
        const [stepId, leaseToken, result, completedAt] = values as [
          string,
          string,
          Record<string, unknown>,
          string,
        ];
        return this.steps(
          this.sql`
            with changed as (
              update public.integration_operation_steps
              set
                state = 'succeeded',
                result = ${this.sql.json(result as postgres.JSONValue)},
                next_attempt_at = null,
                last_error = null,
                lease_token = null,
                worker_id = null,
                leased_at = null,
                lease_expires_at = null,
                completed_at = ${completedAt},
                updated_at = ${completedAt}
              where id = ${stepId}
                and state = 'processing'
                and lease_token = ${leaseToken}::uuid
              returning *
            )
            update public.integration_operations operation
            set
              state = case when not exists (
                select 1
                from public.integration_operation_steps remaining
                where remaining.operation_id = changed.operation_id
                  and remaining.id <> changed.id
                  and remaining.state <> 'succeeded'
              ) then 'synced' else operation.state end,
              synced_at = case when not exists (
                select 1
                from public.integration_operation_steps remaining
                where remaining.operation_id = changed.operation_id
                  and remaining.id <> changed.id
                  and remaining.state <> 'succeeded'
              ) then ${completedAt} else operation.synced_at end,
              last_error = case when not exists (
                select 1
                from public.integration_operation_steps remaining
                where remaining.operation_id = changed.operation_id
                  and remaining.id <> changed.id
                  and remaining.state <> 'succeeded'
              ) then null else operation.last_error end,
              updated_at = ${completedAt}
            from changed
            where operation.id = changed.operation_id
            returning ${this.sql.unsafe(stepColumnsFromChanged)}
          `,
        );
      }
      case "markStepFailed": {
        const [stepId, leaseToken, error, nextAttemptAt, reviewRequired, changedAt] =
          values as [string, string, string, string | undefined, boolean, string];
        return this.steps(
          this.sql`
            with changed as (
              update public.integration_operation_steps
              set
                state = ${reviewRequired ? "review_required" : "retrying"},
                last_error = ${error},
                next_attempt_at = ${nextAttemptAt ?? null},
                lease_token = null,
                worker_id = null,
                leased_at = null,
                lease_expires_at = null,
                updated_at = ${changedAt}
              where id = ${stepId}
                and state = 'processing'
                and lease_token = ${leaseToken}::uuid
              returning *
            )
            update public.integration_operations operation
            set
              state = ${reviewRequired ? "review_required" : "retrying"},
              last_error = ${error},
              updated_at = ${changedAt}
            from changed
            where operation.id = changed.operation_id
            returning ${this.sql.unsafe(stepColumnsFromChanged)}
          `,
        );
      }
      case "retryOperation": {
        const [operationId, changedAt] = values as [string, string];
        return this.operations(
          this.sql`
            with retried as (
              update public.integration_operations
              set
                state = 'retrying',
                attempt_count = attempt_count + 1,
                last_error = null,
                updated_at = ${changedAt}
              where id = ${operationId}::uuid
                and state = 'review_required'
              returning *
            ), reset_steps as (
              update public.integration_operation_steps step
              set
                state = 'retrying',
                next_attempt_at = ${changedAt},
                lease_token = null,
                worker_id = null,
                leased_at = null,
                lease_expires_at = null,
                updated_at = ${changedAt}
              from retried
              where step.operation_id = retried.id
                and step.state = 'review_required'
            )
            select ${this.sql.unsafe(operationColumnsFromRetried)}
            from retried
          `,
        );
      }
      case "cancelOperation": {
        const [operationId, changedAt] = values as [string, string];
        return this.operations(
          this.sql`
            with cancelled as (
              update public.integration_operations
              set
                state = 'cancelled',
                cancelled_at = ${changedAt},
                updated_at = ${changedAt}
              where id = ${operationId}::uuid
                and state <> 'synced'
              returning *
            ), cancelled_steps as (
              update public.integration_operation_steps step
              set
                state = 'cancelled',
                next_attempt_at = null,
                lease_token = null,
                worker_id = null,
                leased_at = null,
                lease_expires_at = null,
                updated_at = ${changedAt}
              from cancelled
              where step.operation_id = cancelled.id
                and step.state not in ('succeeded', 'cancelled')
            )
            select ${this.sql.unsafe(operationColumnsFromCancelled)}
            from cancelled
          `,
        );
      }
      case "listOperations": {
        const [limit] = values as [number];
        return this.operations(
          this.sql`
            select ${this.sql.unsafe(operationColumns)}
            from public.integration_operations
            order by updated_at desc
            limit ${limit}
          `,
        );
      }
      case "getHealth": {
        return this.health(
          this.sql`
            select
              connector::text as "connector",
              status,
              last_checked_at::text as "lastCheckedAt",
              last_success_at::text as "lastSuccessAt",
              last_failure_at::text as "lastFailureAt",
              consecutive_failures as "consecutiveFailures",
              last_error as "lastError"
            from public.integration_connector_health
            order by connector
          `,
        );
      }
      case "getOperation": {
        const [operationId] = values as [string];
        return this.operations(
          this.sql`
            select ${this.sql.unsafe(operationColumns)}
            from public.integration_operations
            where id = ${operationId}::uuid
            limit 1
          `,
        );
      }
      case "recordConnectorRead": {
        const [connector, succeeded, error, checkedAt, requestedStatus] = values as [
          IntegrationConnector,
          boolean,
          string | undefined,
          string,
          IntegrationConnectorHealthStatus | undefined,
        ];
        const status = requestedStatus ?? (succeeded ? "healthy" : "degraded");
        await this.sql`
          insert into public.integration_connector_health (
            connector,
            status,
            last_checked_at,
            last_success_at,
            last_failure_at,
            consecutive_failures,
            last_error
          ) values (
            ${connector},
            ${status},
            ${checkedAt},
            ${succeeded ? checkedAt : null},
            ${succeeded ? null : checkedAt},
            ${succeeded ? 0 : 1},
            ${succeeded ? null : error ?? null}
          )
          on conflict (connector) do update set
            status = excluded.status,
            last_checked_at = excluded.last_checked_at,
            last_success_at = case
              when ${succeeded} then excluded.last_success_at
              else integration_connector_health.last_success_at
            end,
            last_failure_at = case
              when ${succeeded} then integration_connector_health.last_failure_at
              else excluded.last_failure_at
            end,
            consecutive_failures = case
              when ${succeeded} then 0
              else integration_connector_health.consecutive_failures + 1
            end,
            last_error = case
              when ${succeeded} then null
              else excluded.last_error
            end,
            updated_at = ${checkedAt}
        `;
        return [];
      }
      case "appendAudit": {
        const [event] = values as [IntegrationAuditEvent];
        await this.sql`
          insert into public.integration_audit_events (
            operation_id,
            request_id,
            event_type,
            outcome,
            error_code,
            attempt_count,
            http_status,
            duration_ms,
            step_key,
            connector
          ) values (
            ${event.operationId ?? null}::uuid,
            ${event.requestId},
            ${event.eventType},
            ${event.outcome ?? null},
            ${event.errorCode ?? null},
            ${event.attemptCount ?? null},
            ${event.httpStatus ?? null},
            ${event.durationMs ?? null},
            ${event.stepKey ?? null},
            ${event.connector ?? null}
          )
        `;
        return [];
      }
    }
  }

  async transaction<T>(
    callback: (transaction: IntegrationSql) => Promise<T>,
  ): Promise<T> {
    return this.sql.begin((transaction) =>
      callback(new PostgresIntegrationSql(transaction as unknown as postgres.Sql)),
    ) as unknown as Promise<T>;
  }

  private async health(rows: Promise<HealthRow[]>): Promise<IntegrationConnectorHealth[]> {
    return (await rows).map((row) => ({
      ...row,
      lastCheckedAt: row.lastCheckedAt ?? undefined,
      lastError: row.lastError ?? undefined,
      lastFailureAt: row.lastFailureAt ?? undefined,
      lastSuccessAt: row.lastSuccessAt ?? undefined,
    }));
  }

  private async operations(rows: Promise<OperationRow[]>): Promise<IntegrationOperation[]> {
    return (await rows).map((row) => ({
      ...row,
      cancelledAt: row.cancelledAt ?? undefined,
      lastError: row.lastError ?? undefined,
      sourceVersion: row.sourceVersion ?? undefined,
      syncedAt: row.syncedAt ?? undefined,
    }));
  }

  private async steps(rows: Promise<StepRow[]>): Promise<IntegrationOperationStep[]> {
    return (await rows).map((row) => ({
      ...row,
      completedAt: row.completedAt ?? undefined,
      lastError: row.lastError ?? undefined,
      leaseExpiresAt: row.leaseExpiresAt ?? undefined,
      leaseToken: row.leaseToken ?? undefined,
      nextAttemptAt: row.nextAttemptAt ?? undefined,
      result: row.result ?? undefined,
      startedAt: row.startedAt ?? undefined,
      workerId: row.workerId ?? undefined,
    }));
  }
}

type OperationRow = Omit<
  IntegrationOperation,
  "cancelledAt" | "lastError" | "sourceVersion" | "syncedAt"
> & {
  cancelledAt: string | null;
  lastError: string | null;
  sourceVersion: string | null;
  syncedAt: string | null;
};

type StepRow = Omit<
  IntegrationOperationStep,
  | "completedAt"
  | "lastError"
  | "leaseExpiresAt"
  | "leaseToken"
  | "nextAttemptAt"
  | "result"
  | "startedAt"
  | "workerId"
> & {
  completedAt: string | null;
  lastError: string | null;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  nextAttemptAt: string | null;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  workerId: string | null;
};

type HealthRow = Omit<
  IntegrationConnectorHealth,
  "lastCheckedAt" | "lastError" | "lastFailureAt" | "lastSuccessAt"
> & {
  lastCheckedAt: string | null;
  lastError: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

const operationColumns = thisOperationColumns();
const operationColumnsFromRetried = thisOperationColumns("retried");
const operationColumnsFromCancelled = thisOperationColumns("cancelled");
const stepColumns = thisStepColumns();
const stepColumnsFromClaimed = thisStepColumns("claimed");
const stepColumnsFromChanged = thisStepColumns("changed");

function thisOperationColumns(table?: string) {
  const prefix = table ? `${table}.` : "";
  return `${prefix}id::text as "id",
          ${prefix}idempotency_key as "idempotencyKey",
          ${prefix}request_id as "requestId",
          ${prefix}action as "actionType",
          ${prefix}actor_email as "actorEmail",
          ${prefix}source_version as "sourceVersion",
          ${prefix}input_fingerprint as "inputFingerprint",
          ${prefix}payload,
          ${prefix}state::text as "state",
          ${prefix}attempt_count as "attemptCount",
          ${prefix}last_error as "lastError",
          ${prefix}created_at::text as "createdAt",
          ${prefix}updated_at::text as "updatedAt",
          ${prefix}synced_at::text as "syncedAt",
          ${prefix}cancelled_at::text as "cancelledAt"`;
}

function thisStepColumns(table?: string) {
  const prefix = table ? `${table}.` : "";
  return `${prefix}id::text as "id",
          ${prefix}operation_id::text as "operationId",
          ${prefix}step_key as "stepKey",
          ${prefix}step_order as "stepOrder",
          ${prefix}connector::text as "connector",
          ${prefix}action,
          ${prefix}payload,
          ${prefix}state::text as "state",
          ${prefix}attempt_count as "attemptCount",
          ${prefix}next_attempt_at::text as "nextAttemptAt",
          ${prefix}lease_token::text as "leaseToken",
          ${prefix}worker_id as "workerId",
          ${prefix}lease_expires_at::text as "leaseExpiresAt",
          ${prefix}last_error as "lastError",
          ${prefix}result,
          ${prefix}started_at::text as "startedAt",
          ${prefix}completed_at::text as "completedAt",
          ${prefix}created_at::text as "createdAt",
          ${prefix}updated_at::text as "updatedAt"`;
}

function assertMatchingInput(
  existing: IntegrationOperation,
  inputFingerprint: string,
) {
  if (existing.inputFingerprint !== inputFingerprint) {
    throw new Error("This integration idempotency key was already used for different work.");
  }
}

function fingerprintOperationInput(input: EnqueueIntegrationOperation) {
  return fingerprintPayload({
    actionType: input.actionType,
    actorEmail: normalizeEmail(input.actorEmail),
    payload: input.payload,
    requestId: input.requestId ?? null,
    sourceVersion: input.sourceVersion ?? null,
    steps: input.steps.map((step) => ({
      action: step.action,
      connector: step.connector,
      payload: step.payload,
      stepKey: step.stepKey,
    })),
  });
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function boundedWorkerId(workerId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(workerId)) {
    throw new Error("workerId must be a bounded integration worker identifier.");
  }
  return workerId;
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for integration operations.");
  }
  return getSharedPostgresClient(databaseUrl);
}

function requiredRow<T>(rows: readonly unknown[], message: string): T {
  const row = rows[0] as T | undefined;
  if (!row) throw new Error(message);
  return row;
}

function safeError(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

function sanitizeAuditEvent(input: IntegrationAuditEvent): IntegrationAuditEvent {
  return {
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.attemptCount !== undefined ? { attemptCount: input.attemptCount } : {}),
    ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.stepKey ? { stepKey: input.stepKey } : {}),
    ...(input.connector ? { connector: input.connector } : {}),
    eventType: input.eventType,
    requestId: input.requestId,
  };
}
