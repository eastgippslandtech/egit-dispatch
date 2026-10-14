import type { DispatchTestSyncEventInput } from "@/server/dispatch/test-sync";
import {
  getDispatchTestSyncClient,
  recordDispatchTestSyncEvent,
  removeObsoleteDispatchScheduleAssignments,
} from "@/server/dispatch/test-sync";

import { createPostgresIntegrationRepository } from "./repository";
import type { EnqueueIntegrationOperation, IntegrationOperation } from "./types";

type EnqueueResult = {
  operation: Pick<IntegrationOperation, "id" | "state">;
  replayed: boolean;
};

type AtomicScheduleTransaction = {
  claim?(input: MobileScheduleClaim): Promise<void>;
  enqueue(input: EnqueueIntegrationOperation): Promise<EnqueueResult>;
  record(input: DispatchTestSyncEventInput, createdBy: string): Promise<unknown>;
  removeObsolete(input: ScheduleReconciliation): Promise<unknown>;
};

export type MobileScheduleClaim = {
  idempotencyKey: string;
  requestId: string;
  staffId: string;
};

type ScheduleReconciliation = {
  retainedEventIds: string[];
  scheduleGroupId: string;
};

export function createAtomicScheduleWriter({
  transaction,
}: {
  transaction<T>(
    callback: (transaction: AtomicScheduleTransaction) => Promise<T>,
  ): Promise<T>;
}) {
  return {
    async persist(input: {
      createdBy: string;
      events: DispatchTestSyncEventInput[];
      operation: EnqueueIntegrationOperation;
      claim?: MobileScheduleClaim;
      reconciliation?: ScheduleReconciliation;
    }): Promise<EnqueueResult> {
      return transaction(async (current) => {
        if (input.claim) {
          if (!current.claim) {
            throw new Error("Atomic request claiming is not configured.");
          }
          await current.claim(input.claim);
        }
        for (const event of input.events) {
          await current.record(event, input.createdBy);
        }
        if (input.reconciliation) {
          await current.removeObsolete(input.reconciliation);
        }
        return current.enqueue(input.operation);
      });
    },
  };
}

export function createPostgresAtomicScheduleWriter({
  databaseUrl = process.env.DATABASE_URL,
  sql = getDispatchTestSyncClient(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: ReturnType<typeof getDispatchTestSyncClient>;
} = {}) {
  return createAtomicScheduleWriter({
    transaction: (callback) =>
      sql.begin((transactionSql) => {
        const currentSql = transactionSql as unknown as typeof sql;
        const repository = createPostgresIntegrationRepository({ sql: currentSql });
        return callback({
          claim: async ({ idempotencyKey, requestId, staffId }) => {
            const inserted = await currentSql<Array<{ requestId: string }>>`
              insert into public.mobile_dispatch_claims (
                request_id, staff_id, idempotency_key
              )
              values (${requestId}, ${staffId}::uuid, ${idempotencyKey})
              on conflict (request_id) do nothing
              returning request_id as "requestId"
            `;

            if (inserted.length === 0) {
              const existing = await currentSql<Array<{
                idempotencyKey: string;
                staffId: string;
              }>>`
                select staff_id::text as "staffId", idempotency_key as "idempotencyKey"
                from public.mobile_dispatch_claims
                where request_id = ${requestId}
                for update
              `;
              const claim = existing[0];
              if (
                claim?.staffId === staffId &&
                claim.idempotencyKey === idempotencyKey
              ) {
                return;
              }
              throw Object.assign(
                new Error("This request has already been taken by another technician or scheduled."),
                { status: 409 },
              );
            }

            const scheduled = await currentSql<Array<{ id: string }>>`
              select id::text as id
              from public.dispatch_links
              where sdp_request_id = ${requestId}
                and (technician_id is not null or scheduled_start is not null)
              limit 1
            `;
            if (scheduled.length > 0) {
              throw Object.assign(
                new Error("This request has already been assigned or scheduled."),
                { status: 409 },
              );
            }
            const scheduledEvent = await currentSql<Array<{ eventType: string }>>`
              select event_type as "eventType"
              from public.dispatch_test_schedule_events
              where request_id = ${requestId}
              order by created_at desc
              limit 1
            `;
            if (
              scheduledEvent[0]?.eventType === "scheduled" ||
              scheduledEvent[0]?.eventType === "rescheduled"
            ) {
              throw Object.assign(
                new Error("This request already has a schedule in Command Centre."),
                { status: 409 },
              );
            }
          },
          enqueue: (operation) =>
            repository.enqueueInCurrentTransaction(operation),
          record: (event, createdBy) =>
            recordDispatchTestSyncEvent(event, createdBy, currentSql),
          removeObsolete: (input) =>
            removeObsoleteDispatchScheduleAssignments(input, currentSql),
        });
      }) as unknown as ReturnType<typeof callback>,
  });
}
