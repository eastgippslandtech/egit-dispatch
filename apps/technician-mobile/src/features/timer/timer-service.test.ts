import { beforeEach, describe, expect, it } from "vitest";

import { createInMemoryCommandCentreDatabase } from "../../db/database";

import {
  createTimerService,
  elapsedSeconds,
  roundWorklogMinutes,
} from "./timer-service";

const technicianId = "staff-riley";

function at(time: string) {
  return new Date(`2026-07-09T${time}+10:00`);
}

describe("timer service", () => {
  let timer: ReturnType<typeof createTimerService>;

  beforeEach(() => {
    timer = createTimerService(createInMemoryCommandCentreDatabase());
  });

  it("restores elapsed time from timestamps after process suspension", async () => {
    await timer.startLocalTimer({
      jobId: "job-1",
      now: at("09:00:00"),
      technicianId,
    });

    const restored = await timer.restoreActiveTimer({ now: at("09:42:17") });

    expect(restored?.elapsedSeconds).toBe(2537);
  });

  it("retains the server-compatible timer id while offline", async () => {
    const active = await timer.startLocalTimer({
      jobId: "job-1",
      now: at("09:00:00"),
      technicianId,
      timerId: "timer-timer-start-job-1-123",
    });

    expect(active.id).toBe("timer-timer-start-job-1-123");
  });

  it.each([
    [1, 15],
    [15, 15],
    [16, 30],
    [61, 75],
  ])("rounds %i minutes to %i", (actual, expected) => {
    expect(roundWorklogMinutes(actual)).toBe(expected);
  });

  it("stops the active timer with actual and rounded worklog minutes", async () => {
    const active = await timer.startLocalTimer({
      jobId: "job-1",
      now: at("09:00:00"),
      technicianId,
    });

    const stopped = await timer.stopLocalTimer({
      now: at("09:16:10"),
      technicianId,
      timerId: active.id,
    });

    expect(stopped.actualElapsedMinutes).toBe(17);
    expect(stopped.roundedMinutes).toBe(30);
    expect(elapsedSeconds(active, at("09:00:10"))).toBe(10);
  });
});
