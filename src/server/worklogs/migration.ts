import type { EnqueueIntegrationOperation, IntegrationOperation } from "@/server/integrations/types";
import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";
import { fingerprintPayload } from "@/server/integrations/fingerprint";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";

import type { WorklogDispositionCommand } from "./disposition";
import type { WorklogDispositionOperation } from "./processor";

type EnqueueResult = {
  operation: Pick<IntegrationOperation, "id" | "state">;
  replayed: boolean;
};

export type WorklogMigrationTransaction = {
  claimGeneric(idempotencyKey: string): Promise<void>;
  enqueue(operation: EnqueueIntegrationOperation): Promise<EnqueueResult>;
  findLegacyForUpdate(
    idempotencyKey: string,
  ): Promise<WorklogDispositionOperation | undefined>;
  linkGeneric(idempotencyKey: string, operationId: string): Promise<void>;
};

export function createWorklogMigrationCoordinator({
  transaction,
}: {
  transaction<T>(
    callback: (transaction: WorklogMigrationTransaction) => Promise<T>,
  ): Promise<T>;
}) {
  return {
    async enqueue(input: {
      command: WorklogDispositionCommand;
      createOperation(
        command: WorklogDispositionCommand,
        worklogAlreadySaved: boolean,
      ): EnqueueIntegrationOperation;
    }) {
      return transaction(async (current) => {
        const legacy = await current.findLegacyForUpdate(
          input.command.idempotencyKey,
        );
        const command = legacy
          ? matchingLegacyCommand(legacy.command, input.command)
          : input.command;

        if (legacy?.state === "completed") {
          return {
            kind: "legacy" as const,
            operationId: `legacy:${command.idempotencyKey}`,
            status: "synced" as const,
          };
        }
        if (legacy?.executionOwner === "legacy") {
          return {
            kind: "legacy" as const,
            operationId: `legacy:${command.idempotencyKey}`,
            status:
              legacy.state === "recovery_required"
                ? "review_required" as const
                : "syncing" as const,
          };
        }

        if (legacy && !legacy.executionOwner) {
          await current.claimGeneric(command.idempotencyKey);
        }
        const queued = await current.enqueue(
          input.createOperation(
            command,
            legacy?.state === "worklog_saved" ||
              legacy?.state === "recovery_required",
          ),
        );
        if (legacy) {
          await current.linkGeneric(command.idempotencyKey, queued.operation.id);
        }
        return { kind: "operation" as const, ...queued };
      });
    },
  };
}

export function createPostgresWorklogMigrationCoordinator({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}) {
  return createWorklogMigrationCoordinator({
    transaction: (callback) =>
      sql.begin((transactionSql) => {
        const currentSql = transactionSql as unknown as postgres.Sql;
        const integrationRepository = createPostgresIntegrationRepository({
          sql: currentSql,
        });
        return callback({
          claimGeneric: async (idempotencyKey) => {
            await currentSql`
              update public.worklog_disposition_operations
              set execution_owner = 'generic', updated_at = now()
              where idempotency_key = ${idempotencyKey}
                and execution_owner is null
            `;
          },
          enqueue: (operation) =>
            integrationRepository.enqueueInCurrentTransaction(operation),
          findLegacyForUpdate: async (idempotencyKey) => {
            const rows = await currentSql<LegacyRow[]>`
              select
                idempotency_key as "idempotencyKey",
                request_id as "requestId",
                command_payload as "command",
                state,
                last_error as "lastError",
                execution_owner as "executionOwner",
                migrated_operation_id::text as "migratedOperationId"
              from public.worklog_disposition_operations
              where idempotency_key = ${idempotencyKey}
              for update
            `;
            return normalizeLegacy(rows[0]);
          },
          linkGeneric: async (idempotencyKey, operationId) => {
            await currentSql`
              update public.worklog_disposition_operations
              set
                execution_owner = 'generic',
                migrated_operation_id = ${operationId}::uuid,
                migrated_at = coalesce(migrated_at, now()),
                updated_at = now()
              where idempotency_key = ${idempotencyKey}
                and execution_owner = 'generic'
            `;
          },
        });
      }) as unknown as ReturnType<typeof callback>,
  });
}

type LegacyRow = Omit<
  WorklogDispositionOperation,
  "executionOwner" | "migratedOperationId"
> & {
  executionOwner: "generic" | "legacy" | null;
  migratedOperationId: string | null;
};

function normalizeLegacy(row?: LegacyRow): WorklogDispositionOperation | undefined {
  return row
    ? {
        ...row,
        executionOwner: row.executionOwner ?? undefined,
        migratedOperationId: row.migratedOperationId ?? undefined,
      }
    : undefined;
}

function matchingLegacyCommand(
  legacy: WorklogDispositionCommand,
  submitted: WorklogDispositionCommand,
) {
  if (
    fingerprintPayload(jsonCompatible(legacy)) !==
    fingerprintPayload(jsonCompatible(submitted))
  ) {
    throw new Error(
      "This Work Log idempotency key was already used for different work.",
    );
  }
  return legacy;
}

function jsonCompatible(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for Work Log migration.");
  }
  return getSharedPostgresClient(databaseUrl);
}
