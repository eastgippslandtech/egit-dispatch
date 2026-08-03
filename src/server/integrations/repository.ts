import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import { fingerprintPayload } from "./fingerprint";
import type {
  EnqueueIntegrationOperation,
  IntegrationAuditEvent,
  IntegrationConnector,
  IntegrationConnectorHealth,
  IntegrationOperation,
  IntegrationOperationStep,
} from "./types";

type IntegrationQueryName =
  | "appendAudit"
  | "cancelOperation"
  | "claimDueSteps"
  | "findOperationByKey"
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
      return sql.query("claimDueSteps", [
        claimedAt,
        boundedWorkerId(workerId),
        new Date(now.getTime() + leaseDurationMs).toISOString(),
        limit,
      ]);
    },

    async enqueue(input: EnqueueIntegrationOperation) {
      return sql.transaction(async (transaction) => {
        const existing = (await transaction.query("findOperationByKey", [
          input.idempotencyKey,
        ])) as IntegrationOperation[];
        if (existing[0]) {
          assertMatchingPayload(existing[0], input);
          return { operation: existing[0], replayed: true };
        }

        const inserted = (await transaction.query("insertOperation", [
          input,
        ])) as IntegrationOperation[];
        const operation = inserted[0];
        if (!operation) {
          const conflicted = (await transaction.query("findOperationByKey", [
            input.idempotencyKey,
          ])) as IntegrationOperation[];
          const replay = requiredRow(
            conflicted,
            "Integration operation could not be stored.",
          );
          assertMatchingPayload(replay, input);
          return { operation: replay, replayed: true };
        }

        await Promise.all(
          input.steps.map((step, stepOrder) =>
            transaction.query("insertStep", [operation.id, step, stepOrder]),
          ),
        );
        return { operation, replayed: false };
      });
    },

    async getHealth(): Promise<IntegrationConnectorHealth[]> {
      return (await sql.query("getHealth", [])) as IntegrationConnectorHealth[];
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
      succeeded,
    }: {
      connector: IntegrationConnector;
      error?: string;
      now?: Date;
      succeeded: boolean;
    }) {
      await sql.query("recordConnectorRead", [
        connector,
        succeeded,
        error ? safeError(error) : undefined,
        now.toISOString(),
      ]);
    },

    async retryOperation(operationId: string, now = new Date()) {
      return requiredRow<IntegrationOperation>(
        await sql.query("retryOperation", [operationId, now.toISOString()]),
        "Integration operation was not found.",
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
        const [input] = values as [EnqueueIntegrationOperation];
        return this.operations(
          this.sql`
            insert into public.integration_operations (
              idempotency_key,
              request_id,
              action,
              payload
            ) values (
              ${input.idempotencyKey},
              ${input.requestId ?? input.idempotencyKey},
              ${input.actionType},
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
              select id
              from public.integration_operation_steps
              where state in ('queued', 'retrying')
                and (next_attempt_at is null or next_attempt_at <= ${now})
              order by next_attempt_at nulls first, created_at
              for update skip locked
              limit ${limit}
            )
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
            returning ${this.sql.unsafe(stepColumns)}
          `,
        );
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
                select 1 from public.integration_operation_steps
                where operation_id = changed.operation_id
                  and state <> 'succeeded'
              ) then 'synced' else operation.state end,
              synced_at = case when not exists (
                select 1 from public.integration_operation_steps
                where operation_id = changed.operation_id
                  and state <> 'succeeded'
              ) then ${completedAt} else operation.synced_at end,
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
                and state <> 'cancelled'
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
                and step.state not in ('succeeded', 'cancelled')
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
      case "recordConnectorRead": {
        const [connector, succeeded, error, checkedAt] = values as [
          IntegrationConnector,
          boolean,
          string | undefined,
          string,
        ];
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
            ${succeeded ? "healthy" : "degraded"},
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
  "cancelledAt" | "lastError" | "syncedAt"
> & {
  cancelledAt: string | null;
  lastError: string | null;
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
const stepColumnsFromChanged = thisStepColumns("changed");

function thisOperationColumns(table?: string) {
  const prefix = table ? `${table}.` : "";
  return `${prefix}id::text as "id",
          ${prefix}idempotency_key as "idempotencyKey",
          ${prefix}request_id as "requestId",
          ${prefix}action as "actionType",
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

function assertMatchingPayload(
  existing: IntegrationOperation,
  incoming: EnqueueIntegrationOperation,
) {
  if (fingerprintPayload(existing.payload) !== fingerprintPayload(incoming.payload)) {
    throw new Error("This integration idempotency key was already used for different work.");
  }
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

function requiredRow<T>(rows: T[], message: string): T {
  const row = rows[0];
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
