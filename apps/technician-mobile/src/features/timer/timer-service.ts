import type { ActiveTimer, StoppedTimer } from "../../contracts/mobile";
import type { CommandCentreDatabase } from "../../db/database";

interface StartLocalTimerInput {
  jobId: string;
  now: Date;
  technicianId: string;
  timerId?: string;
}

interface RestoreTimerInput {
  now: Date;
  technicianId?: string;
}

interface StopLocalTimerInput {
  now: Date;
  technicianId: string;
  timerId: string;
}

export interface RestoredTimer extends ActiveTimer {
  elapsedSeconds: number;
}

export function createTimerService(database: CommandCentreDatabase) {
  return {
    async restoreActiveTimer({
      now,
      technicianId,
    }: RestoreTimerInput): Promise<RestoredTimer | null> {
      const active = technicianId
        ? await database.getActiveTimer(technicianId)
        : await findAnyActiveTimer(database);
      return active ? { ...active, elapsedSeconds: elapsedSeconds(active, now) } : null;
    },

    async startLocalTimer({
      jobId,
      now,
      technicianId,
      timerId,
    }: StartLocalTimerInput): Promise<ActiveTimer> {
      const existing = await database.getActiveTimer(technicianId);
      if (existing) {
        throw new Error("A timer is already running for this technician.");
      }
      const timer: ActiveTimer = {
        accumulatedPausedSeconds: 0,
        id: timerId ?? `timer-${technicianId}-${now.getTime()}`,
        jobId,
        pausedAt: null,
        startedAt: now.toISOString(),
        technicianId,
      };
      await database.saveActiveTimer(timer);
      return timer;
    },

    async stopLocalTimer({
      now,
      technicianId,
      timerId,
    }: StopLocalTimerInput): Promise<StoppedTimer> {
      const active = await database.getActiveTimer(technicianId);
      if (!active || active.id !== timerId) {
        throw new Error("The active timer does not match this stop command.");
      }
      const actualElapsedMinutes = Math.max(
        1,
        Math.ceil(elapsedSeconds(active, now) / 60),
      );
      const stopped: StoppedTimer = {
        ...active,
        actualElapsedMinutes,
        roundedMinutes: roundWorklogMinutes(actualElapsedMinutes),
        stoppedAt: now.toISOString(),
      };
      await database.clearActiveTimer(technicianId);
      return stopped;
    },
  };
}

export function elapsedSeconds(timer: ActiveTimer, now: Date): number {
  const startedAt = new Date(timer.startedAt);
  return Math.max(
    0,
    Math.floor((now.getTime() - startedAt.getTime()) / 1000) -
      timer.accumulatedPausedSeconds,
  );
}

export function roundWorklogMinutes(actualMinutes: number): number {
  return Math.ceil(actualMinutes / 15) * 15;
}

async function findAnyActiveTimer(
  database: CommandCentreDatabase,
): Promise<ActiveTimer | null> {
  for (const technicianId of [
    "staff-riley",
    "staff-matt",
    "staff-jervy",
    "staff-simeon",
  ]) {
    const active = await database.getActiveTimer(technicianId);
    if (active) return active;
  }
  return null;
}
