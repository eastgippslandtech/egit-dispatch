import postgres from "postgres";

import {
  getServerlessPostgresOptions,
  normalizeServerlessDatabaseUrl,
} from "./postgres-options";

const clients = new Map<string, postgres.Sql>();

export function getSharedPostgresClient(
  databaseUrl: string,
  ssl: "require" | false = "require",
) {
  const serverlessDatabaseUrl = normalizeServerlessDatabaseUrl(databaseUrl);
  const key = `${ssl}:${serverlessDatabaseUrl}`;
  const existing = clients.get(key);
  if (existing) return existing;

  const client = postgres(
    serverlessDatabaseUrl,
    getServerlessPostgresOptions(ssl),
  );
  clients.set(key, client);
  return client;
}
