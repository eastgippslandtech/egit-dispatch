import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import type { WorklogDispositionCommand } from "./disposition";
import type {
  WorklogDispositionOperation,
  WorklogDispositionOperationState,
  WorklogDispositionRepository,
} from "./processor";

type OperationRow = {
  command: WorklogDispositionCommand;
  idempotencyKey: string;
  lastError: string | null;
  requestId: string;
  state: WorklogDispositionOperationState;
};

export function createPostgresWorklogDispositionRepository({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): WorklogDispositionRepository {
  return {
    async begin(command) {
      await sql`
        insert into public.worklog_disposition_operations (
          idempotency_key,
          request_id,
          disposition,
          command_payload
        )
        values (
          ${command.idempotencyKey},
          ${command.requestId},
          ${command.disposition ?? null},
          ${sql.json(command)}
        )
        on conflict (idempotency_key) do nothing
      `;

      const rows = await sql<OperationRow[]>`
        select
          idempotency_key as "idempotencyKey",
          request_id as "requestId",
          command_payload as "command",
          state,
          last_error as "lastError"
        from public.worklog_disposition_operations
        where idempotency_key = ${command.idempotencyKey}
        limit 1
      `;
      const operation = rows[0];
      if (!operation) {
        throw new Error("Work Log disposition operation could not be stored.");
      }
      if (stableStringify(operation.command) !== stableStringify(command)) {
        throw new Error(
          "This Work Log idempotency key was already used for different work.",
        );
      }
      return operation;
    },

    async find(idempotencyKey) {
      const rows = await sql<OperationRow[]>`
        select
          idempotency_key as "idempotencyKey",
          request_id as "requestId",
          command_payload as "command",
          state,
          last_error as "lastError"
        from public.worklog_disposition_operations
        where idempotency_key = ${idempotencyKey}
        limit 1
      `;
      return rows[0];
    },

    async markCompleted(idempotencyKey) {
      await updateState(sql, idempotencyKey, "completed", null);
    },

    async markRecoveryRequired(idempotencyKey, error) {
      await updateState(sql, idempotencyKey, "recovery_required", error);
      await sql`
        update public.dispatch_links dl
        set
          last_sync_status = 'failed',
          last_sync_error = ${error},
          updated_at = now()
        from public.worklog_disposition_operations operation
        where operation.idempotency_key = ${idempotencyKey}
          and dl.sdp_request_id = operation.request_id
      `;
    },

    async markWorklogSaved(idempotencyKey) {
      await updateState(sql, idempotencyKey, "worklog_saved", null);
    },
  };
}

async function updateState(
  sql: postgres.Sql,
  idempotencyKey: string,
  state: WorklogDispositionOperationState,
  lastError: string | null,
) {
  await sql`
    update public.worklog_disposition_operations
    set
      state = ${state},
      last_error = ${lastError},
      attempt_count = attempt_count + 1,
      worklog_saved_at = case
        when ${state} in ('worklog_saved', 'completed', 'recovery_required')
          then coalesce(worklog_saved_at, now())
        else worklog_saved_at
      end,
      completed_at = case when ${state} = 'completed' then now() else completed_at end,
      updated_at = now()
    where idempotency_key = ${idempotencyKey}
  `;
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for Work Log recovery.");
  }
  return getSharedPostgresClient(databaseUrl);
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortForJson(entry)]),
    );
  }
  return value;
}

export function operationForTesting(
  command: WorklogDispositionCommand,
  state: WorklogDispositionOperationState,
): WorklogDispositionOperation {
  return {
    command,
    idempotencyKey: command.idempotencyKey,
    lastError: null,
    requestId: command.requestId,
    state,
  };
}
