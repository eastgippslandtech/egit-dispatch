import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import type {
  MspOAuthTokenStore,
  SharedMspOAuthToken,
} from "./token-cache";

type TokenRow = {
  accessToken: string | null;
  expiresAt: Date | null;
};

let storeSingleton: MspOAuthTokenStore | undefined;

export function getConfiguredMspOAuthTokenStore(
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl?.trim()) {
    return null;
  }

  storeSingleton ??= createPostgresMspOAuthTokenStore(
    getSharedPostgresClient(databaseUrl),
  );
  return storeSingleton;
}

export function createPostgresMspOAuthTokenStore(
  sql: postgres.Sql,
): MspOAuthTokenStore {
  let schemaReady = false;

  async function ensureSchema() {
    if (schemaReady) return;
    await sql`
      create table if not exists public.msp_oauth_access_tokens (
        cache_key text primary key,
        access_token text,
        expires_at timestamptz,
        refresh_blocked_until timestamptz,
        refresh_lease_until timestamptz,
        updated_at timestamptz not null default now(),
        constraint msp_oauth_access_token_pair check (
          (access_token is null and expires_at is null)
          or (access_token is not null and expires_at is not null)
        )
      )
    `;
    await sql`
      comment on table public.msp_oauth_access_tokens is
        'Server-only cache coordinating short-lived MSP Central OAuth access tokens across Vercel instances.'
    `;
    await sql`alter table public.msp_oauth_access_tokens enable row level security`;
    await sql`revoke all on table public.msp_oauth_access_tokens from anon, authenticated`;
    schemaReady = true;
  }

  async function recoverMissingTable<T>(query: () => Promise<T>) {
    try {
      return await query();
    } catch (error) {
      if (!isMissingTokenTableError(error)) throw error;
      await ensureSchema();
      return query();
    }
  }

  return {
    async blockRefresh(cacheKey, blockedUntil) {
      await ensureSchema();
      await sql`
        update public.msp_oauth_access_tokens
        set
          refresh_blocked_until = ${new Date(blockedUntil)},
          refresh_lease_until = null,
          updated_at = now()
        where cache_key = ${cacheKey}
      `;
    },

    async getRefreshBlockedUntil(cacheKey) {
      const rows = await recoverMissingTable(() =>
        sql<Array<{ refreshBlockedUntil: Date | null }>>`
          select refresh_blocked_until as "refreshBlockedUntil"
          from public.msp_oauth_access_tokens
          where cache_key = ${cacheKey}
          limit 1
        `,
      );

      return rows[0]?.refreshBlockedUntil?.getTime() ?? null;
    },

    async getToken(cacheKey) {
      const rows = await recoverMissingTable(() =>
        sql<TokenRow[]>`
          select
            access_token as "accessToken",
            expires_at as "expiresAt"
          from public.msp_oauth_access_tokens
          where cache_key = ${cacheKey}
          limit 1
        `,
      );
      const row = rows[0];

      if (!row?.accessToken || !row.expiresAt) {
        return null;
      }

      return {
        accessToken: row.accessToken,
        expiresAt: row.expiresAt.getTime(),
      };
    },

    async invalidateToken(cacheKey, rejectedAccessToken) {
      await ensureSchema();
      await sql`
        update public.msp_oauth_access_tokens
        set
          access_token = null,
          expires_at = null,
          updated_at = now()
        where cache_key = ${cacheKey}
          and access_token = ${rejectedAccessToken}
      `;
    },

    async releaseRefreshLease(cacheKey) {
      await ensureSchema();
      await sql`
        update public.msp_oauth_access_tokens
        set
          refresh_lease_until = null,
          updated_at = now()
        where cache_key = ${cacheKey}
      `;
    },

    async saveToken(cacheKey, token: SharedMspOAuthToken) {
      await ensureSchema();
      await sql`
        insert into public.msp_oauth_access_tokens (
          cache_key,
          access_token,
          expires_at,
          refresh_blocked_until,
          refresh_lease_until,
          updated_at
        )
        values (
          ${cacheKey},
          ${token.accessToken},
          ${new Date(token.expiresAt)},
          null,
          null,
          now()
        )
        on conflict (cache_key) do update
        set
          access_token = excluded.access_token,
          expires_at = excluded.expires_at,
          refresh_blocked_until = null,
          refresh_lease_until = null,
          updated_at = now()
      `;
    },

    async tryAcquireRefreshLease(cacheKey, now, leaseUntil) {
      await ensureSchema();
      const rows = await sql<Array<{ cacheKey: string }>>`
        insert into public.msp_oauth_access_tokens (
          cache_key,
          refresh_lease_until,
          updated_at
        )
        values (
          ${cacheKey},
          ${new Date(leaseUntil)},
          now()
        )
        on conflict (cache_key) do update
        set
          refresh_lease_until = excluded.refresh_lease_until,
          updated_at = now()
        where (
          public.msp_oauth_access_tokens.refresh_lease_until is null
          or public.msp_oauth_access_tokens.refresh_lease_until <= ${new Date(now)}
        )
        and (
          public.msp_oauth_access_tokens.refresh_blocked_until is null
          or public.msp_oauth_access_tokens.refresh_blocked_until <= ${new Date(now)}
        )
        returning cache_key as "cacheKey"
      `;

      return rows.length > 0;
    },
  };
}

function isMissingTokenTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "message" in error) &&
    (Reflect.get(error, "code") === "42P01" ||
      String(Reflect.get(error, "message") ?? "").includes(
        "msp_oauth_access_tokens",
      ))
  );
}
