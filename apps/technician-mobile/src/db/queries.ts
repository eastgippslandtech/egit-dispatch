import type { ActiveTimer, MobileJob } from "../contracts/mobile";

import type { CommandCentreDatabase } from "./database";

export async function saveCachedJob(
  database: CommandCentreDatabase,
  job: MobileJob,
  updatedAt = job.updatedAt,
): Promise<void> {
  await database.saveCachedJob(job, updatedAt);
}

export async function getCachedJob(
  database: CommandCentreDatabase,
  jobId: string,
): Promise<MobileJob | null> {
  return database.getCachedJob(jobId);
}

export async function listCachedJobs(
  database: CommandCentreDatabase,
): Promise<MobileJob[]> {
  return database.listCachedJobs();
}

export async function saveActiveTimer(
  database: CommandCentreDatabase,
  timer: ActiveTimer,
): Promise<void> {
  await database.saveActiveTimer(timer);
}

export async function getActiveTimer(
  database: CommandCentreDatabase,
  technicianId: string,
): Promise<ActiveTimer | null> {
  return database.getActiveTimer(technicianId);
}

export async function clearActiveTimer(
  database: CommandCentreDatabase,
  technicianId: string,
): Promise<void> {
  await database.clearActiveTimer(technicianId);
}
