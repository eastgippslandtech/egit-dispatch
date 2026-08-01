import type {
  ActiveTimer,
  AddPartCommand,
  AttachEvidenceCommand,
  CompleteJobCommand,
  DateRange,
  MobileJob,
  MobileStaff,
  MutationEnvelope,
  MutationReceipt,
  SaveSignOffCommand,
  SaveWorklogCommand,
  StartTimerCommand,
  StoppedTimer,
  StopTimerCommand,
  UpdateStatusCommand,
} from "../contracts/mobile";
import type { ApiClient } from "../api/client";
import type { CommandCentreDatabase } from "../db/database";
import type { MutationQueue } from "../features/sync/mutation-queue";
import { createTimerService } from "../features/timer/timer-service";

import type { TechnicianRepository } from "./technician-repository";

type RemoteReads = Pick<
  TechnicianRepository,
  "getCurrentStaff" | "getJob" | "listSchedule"
> &
  Partial<TechnicianRepository>;

export interface OfflineTechnicianRepositoryOptions {
  api?: ApiClient;
  database: CommandCentreDatabase;
  queue: MutationQueue;
  remote: RemoteReads | null;
}

export interface SyncNowResult {
  failed: number;
  synced: number;
}

export interface OfflineTechnicianRepository extends TechnicianRepository {
  syncNow(): Promise<SyncNowResult>;
}

export function createOfflineTechnicianRepository({
  api,
  database,
  queue,
  remote,
}: OfflineTechnicianRepositoryOptions): OfflineTechnicianRepository {
  const timers = createTimerService(database);

  async function cacheJob(job: MobileJob): Promise<MobileJob> {
    await database.saveCachedJob(job, job.updatedAt);
    return clone(job);
  }

  async function queueCommand(
    actionType: string,
    command: MutationEnvelope,
  ): Promise<MutationReceipt> {
    await queue.enqueue({
      actionType,
      createdAt: command.occurredAt,
      dependsOn: [],
      id: command.clientMutationId,
      jobId: command.jobId,
      payload: command,
    });

    return {
      clientMutationId: command.clientMutationId,
      mode: "mock",
      recordedAt: command.occurredAt,
      resourceId: command.clientMutationId,
      resourceVersion: command.baseVersion,
      status: "pending",
    };
  }

  return {
    async getCurrentStaff(): Promise<MobileStaff> {
      if (remote) {
        return remote.getCurrentStaff();
      }

      const [firstCachedJob] = await database.listCachedJobs();
      if (firstCachedJob) {
        return firstCachedJob.technician;
      }

      throw new Error("No cached staff profile is available.");
    },

    async listSchedule(range: DateRange): Promise<MobileJob[]> {
      if (remote) {
        try {
          const jobs = await remote.listSchedule(range);
          await Promise.all(jobs.map(cacheJob));
          return jobs;
        } catch {
          // Fall through to the local cache when the network is down.
        }
      }

      const cachedJobs = await database.listCachedJobs();
      return cachedJobs
        .filter((job) => isWithinRange(job, range))
        .sort((left, right) => left.startAt.localeCompare(right.startAt));
    },

    async getJob(jobId: string): Promise<MobileJob> {
      if (remote) {
        try {
          return await cacheJob(await remote.getJob(jobId));
        } catch {
          // Fall through to the local cache when the network is down.
        }
      }

      const cachedJob = await database.getCachedJob(jobId);
      if (!cachedJob) {
        throw new Error("This job is not available offline yet.");
      }
      return cachedJob;
    },

    async startTimer(command: StartTimerCommand): Promise<ActiveTimer> {
      if (remote?.startTimer) {
        return remote.startTimer(command);
      }
      await queueCommand("timer-start", command);
      return timers.startLocalTimer({
        jobId: command.jobId,
        now: new Date(command.occurredAt),
        technicianId: await staffIdFor(command.jobId, database),
      });
    },

    async stopTimer(command: StopTimerCommand): Promise<StoppedTimer> {
      if (remote?.stopTimer) {
        return remote.stopTimer(command);
      }
      await queueCommand("timer-stop", command);
      return timers.stopLocalTimer({
        now: new Date(command.occurredAt),
        technicianId: await staffIdFor(command.jobId, database),
        timerId: command.timerId,
      });
    },

    async saveWorklog(command: SaveWorklogCommand): Promise<MutationReceipt> {
      if (remote?.saveWorklog) {
        try {
          return await remote.saveWorklog(command);
        } catch {
          return queueCommand("notes", command);
        }
      }
      return queueCommand("notes", command);
    },

    async updateStatus(command: UpdateStatusCommand): Promise<MutationReceipt> {
      if (remote?.updateStatus) {
        return remote.updateStatus(command);
      }
      return queueCommand("status", command);
    },

    async attachEvidence(
      command: AttachEvidenceCommand,
    ): Promise<MutationReceipt> {
      if (remote?.attachEvidence) {
        return remote.attachEvidence(command);
      }
      return queueCommand("evidence", command);
    },

    async addPart(command: AddPartCommand): Promise<MutationReceipt> {
      if (remote?.addPart) {
        return remote.addPart(command);
      }
      return queueCommand("parts", command);
    },

    async saveSignOff(command: SaveSignOffCommand): Promise<MutationReceipt> {
      if (remote?.saveSignOff) {
        return remote.saveSignOff(command);
      }
      return queueCommand("sign-off", command);
    },

    async completeJob(command: CompleteJobCommand): Promise<MutationReceipt> {
      if (remote?.completeJob) {
        return remote.completeJob(command);
      }
      return queueCommand("complete", command);
    },

    async syncNow(): Promise<SyncNowResult> {
      if (!api) {
        return { failed: 0, synced: 0 };
      }

      await queue.resetAbandonedSyncing();
      const runnable = await queue.listRunnable();
      let failed = 0;
      let synced = 0;

      for (const mutation of runnable) {
        try {
          await queue.markSyncing(mutation.id);
          await api.sendMutation(mutation);
          await queue.markSynced(mutation.id);
          synced += 1;
        } catch (error) {
          await queue.markFailed(
            mutation.id,
            error instanceof Error ? error.message : "Sync failed.",
          );
          failed += 1;
        }
      }

      return { failed, synced };
    },
  };
}

function isWithinRange(job: MobileJob, range: DateRange): boolean {
  const date = job.startAt.slice(0, 10);
  return date >= range.from && date <= range.to;
}

async function staffIdFor(
  jobId: string,
  database: CommandCentreDatabase,
): Promise<string> {
  const job = await database.getCachedJob(jobId);
  if (!job) {
    throw new Error("The timer job must be cached before offline timer use.");
  }
  return job.technician.id;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
