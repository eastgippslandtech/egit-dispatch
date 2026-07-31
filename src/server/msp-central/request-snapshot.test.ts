import { describe, expect, it, vi } from "vitest";

import type { MspCentralRawRequest } from "./types";
import {
  loadMspRequestsWithSnapshot,
  type MspRequestSnapshotStore,
} from "./request-snapshot";

const cachedRequest: MspCentralRawRequest = {
  id: "cached-1",
  request_number: "REQ-CACHED",
  subject: "Cached request",
};

function createStore(
  snapshot: Awaited<ReturnType<MspRequestSnapshotStore["get"]>>,
): MspRequestSnapshotStore {
  return {
    blockUntil: vi.fn(async () => undefined),
    get: vi.fn(async () => snapshot),
    releaseRefreshLease: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    tryAcquireRefreshLease: vi.fn(async () => true),
  };
}

describe("MSP Central request snapshots", () => {
  it("serves a fresh snapshot without calling MSP Central", async () => {
    const store = createStore({
      fetchedAt: 9_990,
      requests: [cachedRequest],
      retryAfter: null,
    });
    const fetchRequests = vi.fn(async () => []);

    await expect(
      loadMspRequestsWithSnapshot({ fetchRequests, now: () => 10_000, store }),
    ).resolves.toEqual([cachedRequest]);
    expect(fetchRequests).not.toHaveBeenCalled();
  });

  it("serves stale requests and starts a shared backoff after a rate limit", async () => {
    const store = createStore({
      fetchedAt: 1_000,
      requests: [cachedRequest],
      retryAfter: null,
    });
    const rateLimitError = new Error(
      "MSP Central API request failed with status 429.",
    );

    await expect(
      loadMspRequestsWithSnapshot({
        fetchRequests: async () => {
          throw rateLimitError;
        },
        now: () => 100_000,
        store,
      }),
    ).resolves.toEqual([cachedRequest]);
    expect(store.blockUntil).toHaveBeenCalledWith(400_000);
  });

  it("does not call MSP Central during a shared backoff", async () => {
    const store = createStore({
      fetchedAt: 1_000,
      requests: [cachedRequest],
      retryAfter: 200_000,
    });
    const fetchRequests = vi.fn(async () => []);

    await expect(
      loadMspRequestsWithSnapshot({
        fetchRequests,
        now: () => 100_000,
        store,
      }),
    ).resolves.toEqual([cachedRequest]);
    expect(fetchRequests).not.toHaveBeenCalled();
  });

  it("does not keep hammering MSP Central when a backoff has no snapshot yet", async () => {
    const store = createStore({
      fetchedAt: 0,
      requests: [],
      retryAfter: 200_000,
    });
    const fetchRequests = vi.fn(async () => []);

    await expect(
      loadMspRequestsWithSnapshot({
        fetchRequests,
        now: () => 100_000,
        store,
      }),
    ).rejects.toThrow("temporarily rate limited");
    expect(fetchRequests).not.toHaveBeenCalled();
  });

  it("saves a successful MSP Central response for other server workers", async () => {
    const store = createStore(null);
    const liveRequest: MspCentralRawRequest = {
      id: "live-1",
      request_number: "REQ-LIVE",
      subject: "Live request",
    };

    await expect(
      loadMspRequestsWithSnapshot({
        fetchRequests: async () => [liveRequest],
        now: () => 100_000,
        store,
      }),
    ).resolves.toEqual([liveRequest]);
    expect(store.save).toHaveBeenCalledWith([liveRequest], 100_000);
  });
});
