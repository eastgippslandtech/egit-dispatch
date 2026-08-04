import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

export type MspOAuthServiceCredential = {
  apiDomain?: string;
  refreshToken: string;
};

export interface MspOAuthCredentialStore {
  getCredential(): Promise<MspOAuthServiceCredential | null>;
  saveCredential(input: MspOAuthServiceCredential & { updatedBy: string }): Promise<void>;
}

let storeSingleton: MspOAuthCredentialStore | undefined;

export function getConfiguredMspOAuthCredentialStore(
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl?.trim()) {
    return null;
  }

  storeSingleton ??= createPostgresMspOAuthCredentialStore(
    getSharedPostgresClient(databaseUrl),
  );
  return storeSingleton;
}

export function createPostgresMspOAuthCredentialStore(
  sql: postgres.Sql,
): MspOAuthCredentialStore {
  return {
    async getCredential() {
      const rows = await sql<Array<{ apiDomain: string | null; refreshToken: string }>>`
        select
          api_domain as "apiDomain",
          refresh_token as "refreshToken"
        from public.msp_oauth_service_credentials
        where id = 'primary'
        limit 1
      `;
      const row = rows[0];
      return row?.refreshToken
        ? {
            apiDomain: row.apiDomain?.replace(/\/+$/, "") || undefined,
            refreshToken: row.refreshToken,
          }
        : null;
    },

    async saveCredential({ apiDomain, refreshToken, updatedBy }) {
      await sql`
        insert into public.msp_oauth_service_credentials (
          id,
          refresh_token,
          api_domain,
          updated_by,
          updated_at
        )
        values (
          'primary',
          ${refreshToken},
          ${apiDomain ?? null},
          ${updatedBy},
          now()
        )
        on conflict (id) do update
        set
          refresh_token = excluded.refresh_token,
          api_domain = excluded.api_domain,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
    },
  };
}
