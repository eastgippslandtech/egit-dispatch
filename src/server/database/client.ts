import postgres from "postgres";

import {
  getServerlessPostgresOptions,
  normalizeServerlessDatabaseUrl,
} from "./postgres-options";

const clients = new Map<string, postgres.Sql>();

export type SharedPostgresClientOptions = {
  max?: number;
  poolKey?: string;
};

export function getSharedPostgresClient(
  databaseUrl: string,
  ssl: "require" | false = "require",
  options: SharedPostgresClientOptions = {},
) {
  const serverlessDatabaseUrl = normalizeServerlessDatabaseUrl(databaseUrl);
  const poolKey = options.poolKey ?? "default";
  const max = options.max ?? 1;
  const key = `${poolKey}:${ssl}:${max}:${serverlessDatabaseUrl}`;
  const existing = clients.get(key);
  if (existing) return existing;

  const client = postgres(
    serverlessDatabaseUrl,
    getServerlessPostgresOptions(ssl, { max }),
  );
  clients.set(key, client);
  return client;
}
