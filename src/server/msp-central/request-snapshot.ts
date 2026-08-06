import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import { MspCentralConfigurationError } from "./errors";
import type { MspCentralRawRequest } from "./types";

const FRESH_FOR_MS = 5 * 60_000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000;
const REFRESH_LEASE_MS = 20_000;
const SNAPSHOT_DESCRIPTION_LIMIT = 2_000;

export type MspRequestSnapshot = {
  fetchedAt: number;
  requests: MspCentralRawRequest[];
  retryAfter: number | null;
};

export type MspRequestSnapshotStore = {
  blockUntil(timestamp: number): Promise<void>;
  get(): Promise<MspRequestSnapshot | null>;
  releaseRefreshLease(): Promise<void>;
  save(requests: MspCentralRawRequest[], fetchedAt: number): Promise<void>;
  tryAcquireRefreshLease(now: number, leaseUntil: number): Promise<boolean>;
};

export async function loadMspRequestsWithSnapshot({
  fetchRequests,
  now = Date.now,
  store,
}: {
  fetchRequests: () => Promise<MspCentralRawRequest[]>;
  now?: () => number;
  store: MspRequestSnapshotStore | null;
}) {
  if (!store) return fetchRequests();

  let snapshot: MspRequestSnapshot | null = null;
  try {
    snapshot = await store.get();
  } catch {
    return fetchRequests();
  }

  const timestamp = now();
  if (snapshot?.retryAfter && snapshot.retryAfter > timestamp) {
    if (snapshot.requests.length > 0) return snapshot.requests;
    throw new MspCentralConfigurationError(
      "MSP Central request refresh is temporarily rate limited.",
    );
  }

  if (snapshot && timestamp - snapshot.fetchedAt <= FRESH_FOR_MS) {
    return snapshot.requests;
  }

  let acquired = false;
  try {
    acquired = await store.tryAcquireRefreshLease(
      timestamp,
      timestamp + REFRESH_LEASE_MS,
    );
  } catch {
    return fetchRequests();
  }

  if (!acquired) {
    if (snapshot?.requests.length) return snapshot.requests;
    throw new MspCentralConfigurationError(
      "MSP Central request refresh is already in progress.",
    );
  }

  if (snapshot?.requests.length) {
    void refreshSnapshotInBackground({
      fetchRequests,
      fetchedAt: timestamp,
      store,
    });
    return snapshot.requests;
  }

  try {
    const requests = await fetchRequests();
    await store
      .save(compactRequestsForSnapshot(requests), timestamp)
      .catch(() => undefined);
    return requests;
  } catch (error) {
    if (isRateLimitError(error)) {
      await store
        .blockUntil(timestamp + RATE_LIMIT_BACKOFF_MS)
        .catch(() => undefined);
    } else {
      await store.releaseRefreshLease().catch(() => undefined);
    }

    if (snapshot?.requests.length) return snapshot.requests;
    throw error;
  }
}

export async function refreshMspRequestsSnapshot({
  fetchRequests,
  now = Date.now,
  store,
}: {
  fetchRequests: () => Promise<MspCentralRawRequest[]>;
  now?: () => number;
  store: MspRequestSnapshotStore | null;
}) {
  const requests = await fetchRequests();
  if (store) {
    await store.save(compactRequestsForSnapshot(requests), now());
  }
  return requests;
}

export async function loadCachedMspRequestsSnapshot({
  store,
}: {
  store: MspRequestSnapshotStore | null;
}) {
  if (!store) {
    throw new MspCentralConfigurationError(
      "MSP Central request snapshot storage is not configured.",
    );
  }

  const snapshot = await store.get();
  if (!snapshot) {
    throw new MspCentralConfigurationError(
      "MSP Central request snapshot is not available yet.",
    );
  }

  return snapshot.requests;
}

async function refreshSnapshotInBackground({
  fetchRequests,
  fetchedAt,
  store,
}: {
  fetchRequests: () => Promise<MspCentralRawRequest[]>;
  fetchedAt: number;
  store: MspRequestSnapshotStore;
}) {
  try {
    const requests = await fetchRequests();
    await store
      .save(compactRequestsForSnapshot(requests), fetchedAt)
      .catch(() => undefined);
  } catch (error) {
    if (isRateLimitError(error)) {
      await store
        .blockUntil(fetchedAt + RATE_LIMIT_BACKOFF_MS)
        .catch(() => undefined);
      return;
    }

    await store.releaseRefreshLease().catch(() => undefined);
  }
}

export function compactRequestsForSnapshot(
  requests: MspCentralRawRequest[],
): MspCentralRawRequest[] {
  return requests.map((request) => ({
    account: request.account,
    assets: request.assets,
    category: request.category,
    created_time: request.created_time,
    customer: request.customer,
    description: truncateSnapshotText(request.description),
    due_by_time: request.due_by_time,
    id: request.id,
    is_onsite: request.is_onsite,
    item: request.item,
    onsite: request.onsite,
    priority: request.priority,
    request_number: request.request_number,
    requester: request.requester,
    requester_email: request.requester_email,
    requester_name: request.requester_name,
    requester_sentiment: request.requester_sentiment,
    scheduled_end_time: request.scheduled_end_time,
    scheduled_start_time: request.scheduled_start_time,
    sentiment: request.sentiment,
    sentiment_analysis: request.sentiment_analysis,
    site: request.site,
    site_address: request.site_address,
    site_area: request.site_area,
    site_name: request.site_name,
    site_town: request.site_town,
    sla: request.sla,
    sla_status: request.sla_status,
    status: request.status,
    subcategory: request.subcategory,
    subject: request.subject,
    technician: request.technician,
    udf_fields: compactUdfFields(request.udf_fields),
    updated_by: request.updated_by,
    updated_time: request.updated_time,
    last_updated_by: request.last_updated_by,
  }));
}

function compactUdfFields(value: MspCentralRawRequest["udf_fields"]) {
  if (!value) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      typeof fieldValue === "string"
        ? truncateSnapshotText(fieldValue)
        : fieldValue,
    ]),
  );
}

function truncateSnapshotText(value?: string | null) {
  if (!value) return value;
  return value.length > SNAPSHOT_DESCRIPTION_LIMIT
    ? `${value.slice(0, SNAPSHOT_DESCRIPTION_LIMIT)}...`
    : value;
}

const stores = new Map<string, MspRequestSnapshotStore>();

export function getConfiguredMspRequestSnapshotStore({
  databaseUrl = process.env.DATABASE_URL,
  portal,
}: {
  databaseUrl?: string;
  portal?: string;
}) {
  if (!databaseUrl?.trim() || !portal?.trim()) return null;
  const cacheKey = `requests:${portal.trim()}`;
  const storeKey = `${databaseUrl}:${cacheKey}`;
  const existing = stores.get(storeKey);
  if (existing) return existing;

  const store = createPostgresMspRequestSnapshotStore(
    getSharedPostgresClient(databaseUrl),
    cacheKey,
  );
  stores.set(storeKey, store);
  return store;
}

export function createPostgresMspRequestSnapshotStore(
  sql: postgres.Sql,
  cacheKey: string,
): MspRequestSnapshotStore {
  let schemaReady = false;

  async function ensureSchema() {
    if (schemaReady) return;
    await sql`
      create table if not exists public.msp_request_snapshots (
        cache_key text primary key,
        requests jsonb not null default '[]'::jsonb,
        fetched_at timestamptz,
        retry_after timestamptz,
        refresh_lease_until timestamptz,
        updated_at timestamptz not null default now()
      )
    `;
    await sql`
      comment on table public.msp_request_snapshots is
        'Server-only cache for the last successful MSP Central request list.'
    `;
    await sql`alter table public.msp_request_snapshots enable row level security`;
    await sql`revoke all on table public.msp_request_snapshots from anon, authenticated`;
    schemaReady = true;
  }

  return {
    async blockUntil(timestamp) {
      await ensureSchema();
      await sql`
        insert into public.msp_request_snapshots (
          cache_key, retry_after, refresh_lease_until, updated_at
        ) values (
          ${cacheKey}, ${new Date(timestamp)}, null, now()
        )
        on conflict (cache_key) do update set
          retry_after = excluded.retry_after,
          refresh_lease_until = null,
          updated_at = now()
      `;
    },
    async get() {
      const rows = await sql<
        Array<{
          fetchedAt: Date | null;
          requests: MspCentralRawRequest[];
          retryAfter: Date | null;
        }>
      >`
        select
          fetched_at as "fetchedAt",
          requests,
          retry_after as "retryAfter"
        from public.msp_request_snapshots
        where cache_key = ${cacheKey}
        limit 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        fetchedAt: row.fetchedAt?.getTime() ?? 0,
        requests: Array.isArray(row.requests) ? row.requests : [],
        retryAfter: row.retryAfter?.getTime() ?? null,
      };
    },
    async releaseRefreshLease() {
      await sql`
        update public.msp_request_snapshots
        set refresh_lease_until = null, updated_at = now()
        where cache_key = ${cacheKey}
      `;
    },
    async save(requests, fetchedAt) {
      await ensureSchema();
      await sql`
        insert into public.msp_request_snapshots (
          cache_key, requests, fetched_at, retry_after,
          refresh_lease_until, updated_at
        ) values (
          ${cacheKey}, ${sql.json(requests as postgres.JSONValue)},
          ${new Date(fetchedAt)}, null, null, now()
        )
        on conflict (cache_key) do update set
          requests = excluded.requests,
          fetched_at = excluded.fetched_at,
          retry_after = null,
          refresh_lease_until = null,
          updated_at = now()
      `;
    },
    async tryAcquireRefreshLease(now, leaseUntil) {
      await ensureSchema();
      const rows = await sql<Array<{ cacheKey: string }>>`
        insert into public.msp_request_snapshots (
          cache_key, refresh_lease_until, updated_at
        ) values (
          ${cacheKey}, ${new Date(leaseUntil)}, now()
        )
        on conflict (cache_key) do update set
          refresh_lease_until = excluded.refresh_lease_until,
          updated_at = now()
        where (
          public.msp_request_snapshots.refresh_lease_until is null
          or public.msp_request_snapshots.refresh_lease_until <= ${new Date(now)}
        ) and (
          public.msp_request_snapshots.retry_after is null
          or public.msp_request_snapshots.retry_after <= ${new Date(now)}
        )
        returning cache_key as "cacheKey"
      `;
      return rows.length > 0;
    },
  };
}

function isRateLimitError(error: unknown) {
  return error instanceof Error && error.message.includes("status 429");
}
