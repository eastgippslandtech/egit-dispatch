import postgres from "postgres";

import { getServerlessPostgresOptions } from "@/server/database/postgres-options";

const BLOCK_THRESHOLD = 5;
const BLOCK_WINDOW_MS = 15 * 60 * 1000;
const RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WallboardLoginAttempt = {
  attemptKey: string;
  failedAt: Date;
};

export type WallboardLoginAttemptStore = {
  countRecent(attemptKey: string, since: Date): Promise<number>;
  deleteByKey(attemptKey: string): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<void>;
  insert(attempt: WallboardLoginAttempt): Promise<void>;
};

export type WallboardLoginAttemptRepository = {
  isBlocked(attemptKey: string, now?: Date): Promise<boolean>;
  recordFailure(attemptKey: string, failedAt?: Date): Promise<void>;
  clear(attemptKey: string): Promise<void>;
};

let sqlSingleton: postgres.Sql | undefined;

export function createWallboardLoginAttemptRepository(
  store: WallboardLoginAttemptStore,
): WallboardLoginAttemptRepository {
  return {
    async isBlocked(attemptKey, now = new Date()) {
      await store.deleteOlderThan(new Date(now.getTime() - RETENTION_WINDOW_MS));
      const since = new Date(now.getTime() - BLOCK_WINDOW_MS);
      return (await store.countRecent(attemptKey, since)) >= BLOCK_THRESHOLD;
    },
    async recordFailure(attemptKey, failedAt = new Date()) {
      await store.insert({ attemptKey, failedAt });
    },
    clear(attemptKey) {
      return store.deleteByKey(attemptKey);
    },
  };
}

export function createPostgresWallboardLoginAttemptRepository({
  databaseUrl,
  sql = getPostgresSql(databaseUrl),
}: {
  databaseUrl: string;
  sql?: postgres.Sql;
}): WallboardLoginAttemptRepository {
  const store: WallboardLoginAttemptStore = {
    async countRecent(attemptKey, since) {
      const rows = await sql<{ count: number }[]>`
        select count(*)::int as count
        from public.wallboard_login_attempts
        where attempt_key = ${attemptKey}
          and failed_at >= ${since}
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async deleteByKey(attemptKey) {
      await sql`
        delete from public.wallboard_login_attempts
        where attempt_key = ${attemptKey}
      `;
    },

    async deleteOlderThan(cutoff) {
      await sql`
        delete from public.wallboard_login_attempts
        where failed_at < ${cutoff}
      `;
    },

    async insert(attempt) {
      await sql`
        insert into public.wallboard_login_attempts (attempt_key, failed_at)
        values (${attempt.attemptKey}, ${attempt.failedAt})
      `;
    },
  };

  return createWallboardLoginAttemptRepository(store);
}

function getPostgresSql(databaseUrl: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for wallboard login attempts.");
  }

  sqlSingleton ??= postgres(databaseUrl, getServerlessPostgresOptions());
  return sqlSingleton;
}
