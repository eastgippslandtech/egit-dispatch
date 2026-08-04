export function getServerlessPostgresOptions(
  ssl: "require" | false = "require",
) {
  return {
    // Supavisor can take a few seconds to accept a fresh serverless connection
    // during bursts. Keep this above the observed pooler latency so a healthy
    // database is not treated as unavailable while a warm connection is made.
    connect_timeout: 10,
    connection: {
      lock_timeout: 2_000,
      statement_timeout: 8_000,
    },
    idle_timeout: 5,
    // Keep the per-instance pool bounded while allowing dashboard, presence,
    // and integration reads to make progress without serializing behind one query.
    max: 3,
    max_lifetime: 10 * 60,
    prepare: false,
    ssl,
  } as const;
}

export function normalizeServerlessDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (
      url.hostname.endsWith(".pooler.supabase.com") &&
      (!url.port || url.port === "5432")
    ) {
      url.port = "6543";
      return url.toString();
    }
  } catch {
    return databaseUrl;
  }
  return databaseUrl;
}
