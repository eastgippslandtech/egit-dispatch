import type {
  CommandCentreDatabase,
  QueueMutationState,
  StoredQueueMutation,
} from "../../db/database";

export interface QueueMutationInput {
  id: string;
  jobId: string;
  actionType: string;
  payload: unknown;
  dependsOn: string[];
  createdAt: string;
}

export interface QueuedMutation {
  id: string;
  jobId: string;
  actionType: string;
  payload: unknown;
  dependsOn: string[];
  state: QueueMutationState;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface MutationQueue {
  count(): Promise<number>;
  enqueue(input: QueueMutationInput): Promise<QueuedMutation>;
  listRunnable(): Promise<QueuedMutation[]>;
  markFailed(id: string, errorMessage: string): Promise<void>;
  markSynced(id: string): Promise<void>;
  markSyncing(id: string): Promise<void>;
  resetAbandonedSyncing(): Promise<void>;
}

export function createMutationQueue(
  database: CommandCentreDatabase,
): MutationQueue {
  return new PersistentMutationQueue(database);
}

class PersistentMutationQueue implements MutationQueue {
  constructor(private readonly database: CommandCentreDatabase) {}

  async count(): Promise<number> {
    return this.database.countMutations();
  }

  async enqueue(input: QueueMutationInput): Promise<QueuedMutation> {
    validateInput(input);
    const stored = toStoredMutation(input);
    const existing = await this.database.getMutation(input.id);

    if (existing) {
      if (mutationSignature(existing) !== mutationSignature(stored)) {
        throw new Error(
          `Queued mutation idempotency key ${input.id} was reused for different work.`,
        );
      }
      return fromStoredMutation(existing);
    }

    await this.database.saveMutation(stored);
    return fromStoredMutation(stored);
  }

  async listRunnable(): Promise<QueuedMutation[]> {
    const mutations = await this.database.listMutations();
    const syncedIds = new Set(
      mutations
        .filter((mutation) => mutation.state === "synced")
        .map((mutation) => mutation.id),
    );

    return mutations
      .filter(
        (mutation) =>
          mutation.state === "pending" || mutation.state === "failed",
      )
      .filter((mutation) =>
        dependsOn(mutation).every((dependencyId) =>
          syncedIds.has(dependencyId),
        ),
      )
      .map(fromStoredMutation);
  }

  async markSyncing(id: string): Promise<void> {
    await this.database.updateMutation(id, {
      lastError: null,
      state: "syncing",
    });
  }

  async markSynced(id: string): Promise<void> {
    await this.database.updateMutation(id, {
      lastError: null,
      state: "synced",
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const current = await this.database.getMutation(id);
    if (!current) {
      throw new Error(`Queued mutation ${id} was not found.`);
    }
    await this.database.updateMutation(id, {
      attemptCount: current.attemptCount + 1,
      lastError: errorMessage,
      state: "failed",
    });
  }

  async resetAbandonedSyncing(): Promise<void> {
    await this.database.resetSyncingMutations();
  }
}

function validateInput(input: QueueMutationInput): void {
  if (!input.id.trim()) {
    throw new Error("Queued mutation id is required.");
  }
  if (!input.jobId.trim()) {
    throw new Error("Queued mutation job id is required.");
  }
  if (!input.actionType.trim()) {
    throw new Error("Queued mutation action type is required.");
  }
  if (Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error("Queued mutation createdAt must be an ISO timestamp.");
  }
}

function toStoredMutation(input: QueueMutationInput): StoredQueueMutation {
  return {
    actionType: input.actionType,
    attemptCount: 0,
    createdAt: input.createdAt,
    dependsOnJson: JSON.stringify([...input.dependsOn].sort()),
    id: input.id,
    jobId: input.jobId,
    lastError: null,
    payloadJson: stableStringify(input.payload),
    state: "pending",
  };
}

function fromStoredMutation(mutation: StoredQueueMutation): QueuedMutation {
  return {
    actionType: mutation.actionType,
    attemptCount: mutation.attemptCount,
    createdAt: mutation.createdAt,
    dependsOn: dependsOn(mutation),
    id: mutation.id,
    jobId: mutation.jobId,
    lastError: mutation.lastError,
    payload: JSON.parse(mutation.payloadJson) as unknown,
    state: mutation.state,
  };
}

function dependsOn(mutation: StoredQueueMutation): string[] {
  return JSON.parse(mutation.dependsOnJson) as string[];
}

function mutationSignature(mutation: StoredQueueMutation): string {
  return JSON.stringify({
    actionType: mutation.actionType,
    dependsOnJson: mutation.dependsOnJson,
    jobId: mutation.jobId,
    payloadJson: mutation.payloadJson,
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortForJson(entryValue)]),
    );
  }
  return value;
}
