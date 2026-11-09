import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

export interface RequestNicknameRepository {
  list(requestIds: string[]): Promise<Record<string, string>>;
  set(requestId: string, nickname: string | null, actorEmail: string): Promise<void>;
}

let singleton: RequestNicknameRepository | undefined;

export function getConfiguredRequestNicknameRepository(
  databaseUrl = process.env.DATABASE_URL,
): RequestNicknameRepository | null {
  if (!databaseUrl?.trim()) return null;
  singleton ??= createPostgresRequestNicknameRepository({ databaseUrl });
  return singleton;
}

export function createPostgresRequestNicknameRepository({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): RequestNicknameRepository {
  return {
    async list(requestIds) {
      if (requestIds.length === 0) return {};
      const rows = await sql<Array<{ request_id: string; nickname: string }>>`
        select request_id, nickname
        from public.request_nicknames
        where request_id = any(${requestIds}::text[])
      `;
      return Object.fromEntries(rows.map((row) => [row.request_id, row.nickname]));
    },

    async set(requestId, nickname, actorEmail) {
      if (nickname === null) {
        await sql`
          delete from public.request_nicknames
          where request_id = ${requestId}
        `;
        return;
      }
      await sql`
        insert into public.request_nicknames (
          request_id, nickname, updated_by_email, updated_at
        ) values (
          ${requestId}, ${nickname}, ${actorEmail}, now()
        )
        on conflict (request_id) do update set
          nickname = excluded.nickname,
          updated_by_email = excluded.updated_by_email,
          updated_at = excluded.updated_at
      `;
    },
  };
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for ticket nicknames.");
  }
  return getSharedPostgresClient(databaseUrl);
}
