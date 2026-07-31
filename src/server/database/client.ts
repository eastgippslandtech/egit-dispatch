import postgres from "postgres";

import { getServerlessPostgresOptions } from "./postgres-options";

const clients = new Map<string, postgres.Sql>();

export function getSharedPostgresClient(
  databaseUrl: string,
  ssl: "require" | false = "require",
) {
  const key = `${ssl}:${databaseUrl}`;
  const existing = clients.get(key);
  if (existing) return existing;

  const client = postgres(databaseUrl, getServerlessPostgresOptions(ssl));
  clients.set(key, client);
  return client;
}
