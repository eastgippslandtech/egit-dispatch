export function getServerlessPostgresOptions(
  ssl: "require" | false = "require",
) {
  return {
    connect_timeout: 10,
    connection: {
      lock_timeout: 2_000,
      statement_timeout: 8_000,
    },
    idle_timeout: 5,
    // Keep a small pool so one slow transaction cannot block unrelated
    // wallboard reads and background integration recovery work.
    max: 4,
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
