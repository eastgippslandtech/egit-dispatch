export const SCHEMA_VERSION = 1;

export const SCHEMA_VERSION_KEY = "schema_version";

export const schemaVersionOneStatements = [
  `CREATE TABLE IF NOT EXISTS jobs_cache (
    id TEXT PRIMARY KEY NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS active_timer (
    technician_id TEXT PRIMARY KEY NOT NULL,
    timer_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    started_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mutation_queue (
    id TEXT PRIMARY KEY NOT NULL,
    job_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    depends_on_json TEXT NOT NULL,
    state TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL
  )`,
] as const;
