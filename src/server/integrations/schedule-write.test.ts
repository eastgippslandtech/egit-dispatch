import { describe, expect, it, vi } from "vitest";

import type { DispatchTestSyncEventInput } from "@/server/dispatch/test-sync";

import { createAtomicScheduleWriter } from "./schedule-write";
import type { EnqueueIntegrationOperation } from "./types";

const operation: EnqueueIntegrationOperation = {
  actionType: "dispatch.schedule",
  actorEmail: "simeon@egit.com.au",
  idempotencyKey: "schedule-command-123",
  payload: { requestId: "request-123" },
  requestId: "request-123",
  steps: [],
};

const events: DispatchTestSyncEventInput[] = [
  scheduleEvent("lead", "tech-matt"),
  scheduleEvent("crew-jervy", "tech-jervy"),
];

describe("atomic schedule writer", () => {
  it("rolls back local lead and crew records when enqueue fails", async () => {
    const committedEvents: DispatchTestSyncEventInput[] = [];
    const committedOperations: EnqueueIntegrationOperation[] = [];
    const writer = createAtomicScheduleWriter({
      transaction: async (callback) => {
        const stagedEvents: DispatchTestSyncEventInput[] = [];
        const stagedOperations: EnqueueIntegrationOperation[] = [];
        const result = await callback({
          enqueue: async (input) => {
            stagedOperations.push(input);
            throw new Error("queue insert failed");
          },
          record: async (event) => {
            stagedEvents.push(event);
          },
        });
        committedEvents.push(...stagedEvents);
        committedOperations.push(...stagedOperations);
        return result;
      },
    });

    await expect(
      writer.persist({ createdBy: "simeon@egit.com.au", events, operation }),
    ).rejects.toThrow("queue insert failed");
    expect(committedEvents).toEqual([]);
    expect(committedOperations).toEqual([]);
  });

  it("commits every local assignment with the queued operation", async () => {
    const record = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => ({
      operation: { id: "operation-1", state: "queued" as const },
      replayed: false,
    }));
    const writer = createAtomicScheduleWriter({
      transaction: async (callback) => callback({ enqueue, record }),
    });

    await writer.persist({ createdBy: "simeon@egit.com.au", events, operation });

    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenNthCalledWith(1, events[0], "simeon@egit.com.au");
    expect(record).toHaveBeenNthCalledWith(2, events[1], "simeon@egit.com.au");
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(operation);
  });
});

function scheduleEvent(
  id: string,
  technicianId: string,
): DispatchTestSyncEventInput {
  return {
    appointmentId: id,
    date: "2026-08-04",
    end: "11:00",
    eventType: "scheduled",
    id,
    requestId: "request-123",
    start: "10:00",
    technicianId,
  };
}
