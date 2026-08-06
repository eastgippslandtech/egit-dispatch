import { describe, expect, it, vi } from "vitest";

import type { MspCentralRawRequest } from "./types";
import {
  compactRequestsForSnapshot,
  createPostgresMspRequestSnapshotStore,
  loadCachedMspRequestsSnapshot,
  loadMspRequestsWithSnapshot,
  refreshMspRequestsSnapshot,
  type MspRequestSnapshotStore,
} from "./request-snapshot";
import type postgres from "postgres";

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
  it("does not run schema DDL during an ordinary snapshot read", async () => {
    const queries: string[] = [];
    const sql = Object.assign(
      vi.fn(async (strings: TemplateStringsArray) => {
        queries.push(strings.join("?"));
        return [];
      }),
      { json: vi.fn((value) => value) },
    );
    const store = createPostgresMspRequestSnapshotStore(
      sql as unknown as postgres.Sql,
      "requests:portal",
    );

    await store.get();

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("from public.msp_request_snapshots");
    expect(queries[0]).not.toMatch(/create table|alter table|revoke all/i);
  });

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
        now: () => 400_000,
        store,
      }),
    ).resolves.toEqual([cachedRequest]);
    expect(store.blockUntil).toHaveBeenCalledWith(700_000);
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

  it("force-refreshes and saves a new snapshot for fast dashboard reads", async () => {
    const store = createStore({
      fetchedAt: 1_000,
      requests: [cachedRequest],
      retryAfter: null,
    });
    const refreshedRequest: MspCentralRawRequest = {
      id: "live-2",
      request_number: "REQ-REFRESHED",
      subject: "Refreshed request",
    };

    await expect(
      refreshMspRequestsSnapshot({
        fetchRequests: async () => [refreshedRequest],
        now: () => 200_000,
        store,
      }),
    ).resolves.toEqual([refreshedRequest]);
    expect(store.save).toHaveBeenCalledWith([refreshedRequest], 200_000);
  });

  it("trims heavy request fields before storing dashboard snapshots", () => {
    const compacted = compactRequestsForSnapshot([
      {
        ...cachedRequest,
        description: "x".repeat(2_500),
        udf_fields: {
          ready_to_book: true,
          site_hint: "y".repeat(2_500),
        },
      },
    ]);

    expect(compacted[0]?.description).toHaveLength(2_003);
    expect(compacted[0]?.udf_fields?.site_hint).toHaveLength(2_003);
    expect(compacted[0]?.udf_fields?.ready_to_book).toBe(true);
  });

  it("serves cached snapshots without starting a provider refresh", async () => {
    const store = createStore({
      fetchedAt: 1_000,
      requests: [cachedRequest],
      retryAfter: null,
    });

    await expect(loadCachedMspRequestsSnapshot({ store })).resolves.toEqual([
      cachedRequest,
    ]);
    expect(store.tryAcquireRefreshLease).not.toHaveBeenCalled();
  });
});
