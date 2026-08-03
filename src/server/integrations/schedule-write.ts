import type { DispatchTestSyncEventInput } from "@/server/dispatch/test-sync";
import {
  getDispatchTestSyncClient,
  recordDispatchTestSyncEvent,
} from "@/server/dispatch/test-sync";

import { createPostgresIntegrationRepository } from "./repository";
import type { EnqueueIntegrationOperation, IntegrationOperation } from "./types";

type EnqueueResult = {
  operation: Pick<IntegrationOperation, "id" | "state">;
  replayed: boolean;
};

type AtomicScheduleTransaction = {
  enqueue(input: EnqueueIntegrationOperation): Promise<EnqueueResult>;
  record(input: DispatchTestSyncEventInput, createdBy: string): Promise<unknown>;
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
    }): Promise<EnqueueResult> {
      return transaction(async (current) => {
        for (const event of input.events) {
          await current.record(event, input.createdBy);
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
          enqueue: (operation) =>
            repository.enqueueInCurrentTransaction(operation),
          record: (event, createdBy) =>
            recordDispatchTestSyncEvent(event, createdBy, currentSql),
        });
      }) as unknown as ReturnType<typeof callback>,
  });
}
