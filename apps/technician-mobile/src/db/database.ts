import type { ActiveTimer, MobileJob } from "../contracts/mobile";
import type { SQLiteDatabase } from "expo-sqlite";

import { schemaVersionOneStatements } from "./migrations";

export type QueueMutationState = "pending" | "syncing" | "failed" | "synced";

export interface StoredQueueMutation {
  id: string;
  jobId: string;
  actionType: string;
  payloadJson: string;
  dependsOnJson: string;
  state: QueueMutationState;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface CommandCentreDatabase {
  applyMigrations(statements: readonly string[]): Promise<void>;
  getCachedJob(jobId: string): Promise<MobileJob | null>;
  listCachedJobs(): Promise<MobileJob[]>;
  saveCachedJob(job: MobileJob, updatedAt: string): Promise<void>;
  getActiveTimer(technicianId: string): Promise<ActiveTimer | null>;
  saveActiveTimer(timer: ActiveTimer): Promise<void>;
  clearActiveTimer(technicianId: string): Promise<void>;
  countMutations(): Promise<number>;
  getMutation(id: string): Promise<StoredQueueMutation | null>;
  listMutations(): Promise<StoredQueueMutation[]>;
  saveMutation(mutation: StoredQueueMutation): Promise<void>;
  updateMutation(
    id: string,
    patch: Partial<
      Pick<
        StoredQueueMutation,
        "attemptCount" | "lastError" | "state"
      >
    >,
  ): Promise<void>;
  resetSyncingMutations(): Promise<void>;
}

export async function openCommandCentreDatabase(): Promise<CommandCentreDatabase> {
  const sqlite = await import("expo-sqlite");
  const database = await sqlite.openDatabaseAsync("command-centre.db");
  const adapter = new ExpoSQLiteCommandCentreDatabase(database);
  await migrateDatabase(adapter);
  return adapter;
}

export async function migrateDatabase(
  database: CommandCentreDatabase,
): Promise<void> {
  await database.applyMigrations(schemaVersionOneStatements);
}

export function createInMemoryCommandCentreDatabase(): CommandCentreDatabase {
  return new InMemoryCommandCentreDatabase();
}

type ExpoSQLiteDatabase = {
  execAsync(sql: string): Promise<void>;
  getAllAsync: SQLiteDatabase["getAllAsync"];
  getFirstAsync: SQLiteDatabase["getFirstAsync"];
  runAsync: SQLiteDatabase["runAsync"];
};

class ExpoSQLiteCommandCentreDatabase implements CommandCentreDatabase {
  constructor(private readonly database: ExpoSQLiteDatabase) {}

  async applyMigrations(statements: readonly string[]): Promise<void> {
    for (const statement of statements) {
      await this.database.execAsync(statement);
    }
  }

  async getCachedJob(jobId: string): Promise<MobileJob | null> {
    const row = await this.database.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM jobs_cache WHERE id = ?",
      [jobId],
    );
    return row ? (JSON.parse(row.payload_json) as MobileJob) : null;
  }

  async listCachedJobs(): Promise<MobileJob[]> {
    const rows = await this.database.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM jobs_cache ORDER BY updated_at DESC",
      [],
    );
    return rows.map((row) => JSON.parse(row.payload_json) as MobileJob);
  }

  async saveCachedJob(job: MobileJob, updatedAt: string): Promise<void> {
    await this.database.runAsync(
      `INSERT OR REPLACE INTO jobs_cache (id, payload_json, updated_at)
       VALUES (?, ?, ?)`,
      [job.id, JSON.stringify(job), updatedAt],
    );
  }

  async getActiveTimer(technicianId: string): Promise<ActiveTimer | null> {
    const row = await this.database.getFirstAsync<{
      job_id: string;
      started_at: string;
      timer_id: string;
    }>("SELECT timer_id, job_id, started_at FROM active_timer WHERE technician_id = ?", [
      technicianId,
    ]);
    return row
      ? {
          accumulatedPausedSeconds: 0,
          id: row.timer_id,
          jobId: row.job_id,
          pausedAt: null,
          startedAt: row.started_at,
          technicianId,
        }
      : null;
  }

  async saveActiveTimer(timer: ActiveTimer): Promise<void> {
    await this.database.runAsync(
      `INSERT OR REPLACE INTO active_timer
       (technician_id, timer_id, job_id, started_at)
       VALUES (?, ?, ?, ?)`,
      [timer.technicianId, timer.id, timer.jobId, timer.startedAt],
    );
  }

  async clearActiveTimer(technicianId: string): Promise<void> {
    await this.database.runAsync(
      "DELETE FROM active_timer WHERE technician_id = ?",
      [technicianId],
    );
  }

  async countMutations(): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM mutation_queue",
      [],
    );
    return row?.count ?? 0;
  }

  async getMutation(id: string): Promise<StoredQueueMutation | null> {
    const row = await this.database.getFirstAsync<MutationRow>(
      `SELECT id, job_id, action_type, payload_json, depends_on_json, state,
              attempt_count, last_error, created_at
       FROM mutation_queue
       WHERE id = ?`,
      [id],
    );
    return row ? fromMutationRow(row) : null;
  }

  async listMutations(): Promise<StoredQueueMutation[]> {
    const rows = await this.database.getAllAsync<MutationRow>(
      `SELECT id, job_id, action_type, payload_json, depends_on_json, state,
              attempt_count, last_error, created_at
       FROM mutation_queue
       ORDER BY created_at ASC, id ASC`,
      [],
    );
    return rows.map(fromMutationRow);
  }

  async saveMutation(mutation: StoredQueueMutation): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO mutation_queue
       (id, job_id, action_type, payload_json, depends_on_json, state,
        attempt_count, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mutation.id,
        mutation.jobId,
        mutation.actionType,
        mutation.payloadJson,
        mutation.dependsOnJson,
        mutation.state,
        mutation.attemptCount,
        mutation.lastError,
        mutation.createdAt,
      ],
    );
  }

  async updateMutation(
    id: string,
    patch: Partial<
      Pick<StoredQueueMutation, "attemptCount" | "lastError" | "state">
    >,
  ): Promise<void> {
    const current = await this.getMutation(id);
    if (!current) {
      throw new Error(`Queued mutation ${id} was not found.`);
    }
    const updated = { ...current, ...patch };
    await this.database.runAsync(
      `UPDATE mutation_queue
       SET state = ?, attempt_count = ?, last_error = ?
       WHERE id = ?`,
      [updated.state, updated.attemptCount, updated.lastError, id],
    );
  }

  async resetSyncingMutations(): Promise<void> {
    await this.database.runAsync(
      "UPDATE mutation_queue SET state = 'pending' WHERE state = 'syncing'",
    );
  }
}

interface MutationRow {
  action_type: string;
  attempt_count: number;
  created_at: string;
  depends_on_json: string;
  id: string;
  job_id: string;
  last_error: string | null;
  payload_json: string;
  state: QueueMutationState;
}

function fromMutationRow(row: MutationRow): StoredQueueMutation {
  return {
    actionType: row.action_type,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    dependsOnJson: row.depends_on_json,
    id: row.id,
    jobId: row.job_id,
    lastError: row.last_error,
    payloadJson: row.payload_json,
    state: row.state,
  };
}

class InMemoryCommandCentreDatabase implements CommandCentreDatabase {
  private readonly activeTimers = new Map<string, ActiveTimer>();
  private readonly jobs = new Map<string, MobileJob>();
  private readonly mutations = new Map<string, StoredQueueMutation>();

  async applyMigrations(): Promise<void> {
    // The in-memory adapter is already structurally migrated.
  }

  async getCachedJob(jobId: string): Promise<MobileJob | null> {
    return cloneOrNull(this.jobs.get(jobId));
  }

  async listCachedJobs(): Promise<MobileJob[]> {
    return [...this.jobs.values()].map(clone);
  }

  async saveCachedJob(job: MobileJob): Promise<void> {
    this.jobs.set(job.id, clone(job));
  }

  async getActiveTimer(technicianId: string): Promise<ActiveTimer | null> {
    return cloneOrNull(this.activeTimers.get(technicianId));
  }

  async saveActiveTimer(timer: ActiveTimer): Promise<void> {
    this.activeTimers.set(timer.technicianId, clone(timer));
  }

  async clearActiveTimer(technicianId: string): Promise<void> {
    this.activeTimers.delete(technicianId);
  }

  async countMutations(): Promise<number> {
    return this.mutations.size;
  }

  async getMutation(id: string): Promise<StoredQueueMutation | null> {
    return cloneOrNull(this.mutations.get(id));
  }

  async listMutations(): Promise<StoredQueueMutation[]> {
    return [...this.mutations.values()]
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      )
      .map(clone);
  }

  async saveMutation(mutation: StoredQueueMutation): Promise<void> {
    if (this.mutations.has(mutation.id)) {
      throw new Error(`Queued mutation ${mutation.id} already exists.`);
    }
    this.mutations.set(mutation.id, clone(mutation));
  }

  async updateMutation(
    id: string,
    patch: Partial<
      Pick<StoredQueueMutation, "attemptCount" | "lastError" | "state">
    >,
  ): Promise<void> {
    const current = this.mutations.get(id);
    if (!current) {
      throw new Error(`Queued mutation ${id} was not found.`);
    }
    this.mutations.set(id, { ...current, ...clone(patch) });
  }

  async resetSyncingMutations(): Promise<void> {
    for (const mutation of this.mutations.values()) {
      if (mutation.state === "syncing") {
        mutation.state = "pending";
      }
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value ? clone(value) : null;
}
