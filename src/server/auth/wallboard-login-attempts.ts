import { Pool } from "pg";

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

type QueryResult = { rows: Array<{ count?: string | number }> };
export type WallboardLoginAttemptSql = (
  query: string,
  values?: unknown[],
) => Promise<QueryResult>;

export function createPostgresWallboardLoginAttemptRepository({
  databaseUrl,
  sql,
}: {
  databaseUrl: string;
  sql?: WallboardLoginAttemptSql;
}): WallboardLoginAttemptRepository {
  if (!databaseUrl && !sql) {
    throw new Error("DATABASE_URL is required for wallboard login attempts.");
  }

  const pool = sql ? undefined : new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  const query: WallboardLoginAttemptSql =
    sql ?? ((text, values) => pool!.query(text, values));

  return createWallboardLoginAttemptRepository({
    async countRecent(attemptKey, since) {
      const result = await query(
        `select count(*)::int as count
           from public.wallboard_login_attempts
          where attempt_key = $1 and failed_at >= $2`,
        [attemptKey, since],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
    async deleteByKey(attemptKey) {
      await query(
        "delete from public.wallboard_login_attempts where attempt_key = $1",
        [attemptKey],
      );
    },
    async deleteOlderThan(cutoff) {
      await query(
        "delete from public.wallboard_login_attempts where failed_at < $1",
        [cutoff],
      );
    },
    async insert(attempt) {
      await query(
        "insert into public.wallboard_login_attempts (attempt_key, failed_at) values ($1, $2)",
        [attempt.attemptKey, attempt.failedAt],
      );
    },
  });
}

function shouldUseSsl(databaseUrl: string) {
  return !databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1");
}
