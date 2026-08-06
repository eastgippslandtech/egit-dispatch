export function getServerlessPostgresOptions(
  ssl: "require" | false = "require",
  options: { max?: number } = {},
) {
  return {
    connect_timeout: 3,
    connection: {
      lock_timeout: 2_000,
      statement_timeout: 8_000,
    },
    idle_timeout: 5,
    // Vercel creates a pool per warm function instance. Supabase's transaction
    // pooler already multiplexes those clients, so one connection per instance
    // avoids exhausting shared pooler clients during concurrent page refreshes.
    max: options.max ?? 1,
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
