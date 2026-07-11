import { beforeEach, describe, expect, it } from "vitest";

import { createInMemoryCommandCentreDatabase } from "../../db/database";

import {
  createMutationQueue,
  type QueueMutationInput,
} from "./mutation-queue";

function worklogMutation(
  overrides: Partial<QueueMutationInput> & { id: string },
): QueueMutationInput {
  return {
    id: overrides.id,
    jobId: overrides.jobId ?? "firewall-riley",
    actionType: overrides.actionType ?? "worklog",
    payload: overrides.payload ?? { summary: "Updated work note" },
    dependsOn: overrides.dependsOn ?? [],
    createdAt: overrides.createdAt ?? "2026-07-09T00:00:00.000Z",
  };
}

function completeMutation(
  overrides: Partial<QueueMutationInput> & { id: string },
): QueueMutationInput {
  return {
    id: overrides.id,
    jobId: overrides.jobId ?? "firewall-riley",
    actionType: "complete",
    payload: overrides.payload ?? { summary: "Completed on site" },
    dependsOn: overrides.dependsOn ?? [],
    createdAt: overrides.createdAt ?? "2026-07-09T00:02:00.000Z",
  };
}

describe("mutation queue", () => {
  let database: ReturnType<typeof createInMemoryCommandCentreDatabase>;
  let queue: ReturnType<typeof createMutationQueue>;

  beforeEach(async () => {
    database = createInMemoryCommandCentreDatabase();
    queue = createMutationQueue(database);
    await queue.resetAbandonedSyncing();
  });

  it("returns queued mutations in dependency and creation order", async () => {
    await queue.enqueue(worklogMutation({ id: "worklog-1" }));
    await queue.enqueue(
      completeMutation({ id: "complete-1", dependsOn: ["worklog-1"] }),
    );
    await queue.enqueue(
      worklogMutation({
        id: "worklog-2",
        createdAt: "2026-07-09T00:01:00.000Z",
      }),
    );

    expect((await queue.listRunnable()).map((item) => item.id)).toEqual([
      "worklog-1",
      "worklog-2",
    ]);

    await queue.markSynced("worklog-1");

    expect((await queue.listRunnable()).map((item) => item.id)).toEqual([
      "worklog-2",
      "complete-1",
    ]);
  });

  it("does not duplicate an existing idempotency key", async () => {
    await queue.enqueue(worklogMutation({ id: "same-key" }));
    await queue.enqueue(worklogMutation({ id: "same-key" }));

    expect(await queue.count()).toBe(1);
  });

  it("rejects an idempotency key reused for a different mutation", async () => {
    await queue.enqueue(worklogMutation({ id: "same-key" }));

    await expect(
      queue.enqueue(
        worklogMutation({
          id: "same-key",
          payload: { summary: "Different operation payload" },
        }),
      ),
    ).rejects.toThrow("idempotency key");
  });

  it("resets abandoned syncing mutations back to pending", async () => {
    await queue.enqueue(worklogMutation({ id: "worklog-1" }));
    await queue.markSyncing("worklog-1");

    expect(await queue.listRunnable()).toHaveLength(0);

    await queue.resetAbandonedSyncing();

    expect((await queue.listRunnable()).map((item) => item.id)).toEqual([
      "worklog-1",
    ]);
  });

  it("keeps failed mutations runnable with their last error", async () => {
    await queue.enqueue(worklogMutation({ id: "worklog-1" }));

    await queue.markFailed("worklog-1", "Network unavailable");

    const [mutation] = await queue.listRunnable();
    expect(mutation).toMatchObject({
      attemptCount: 1,
      id: "worklog-1",
      lastError: "Network unavailable",
      state: "failed",
    });
  });
});
