import { revalidatePath } from "next/cache";

import { readDispatchConfig } from "@/server/dispatch/env";
import { getConfiguredDispatchLinkStore } from "@/server/dispatch/link-store";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";

import { createCommandCentreAdapters } from "./adapters/command-centre";
import { createMspCentralAdapters } from "./adapters/msp-central";
import { createOutlookAdapters } from "./adapters/outlook";
import { createIntegrationProcessor } from "./processor";
import { createIntegrationAdapterRegistry } from "./registry";
import { createPostgresIntegrationRepository } from "./repository";

export function createConfiguredIntegrationWorker() {
  const config = readDispatchConfig();
  const databaseUrl = requiredDatabaseUrl(config.databaseUrl);
  const repository = createPostgresIntegrationRepository({ databaseUrl });
  const adapters = {
    ...createMspCentralAdapters({ client: createMspCentralClient(config) }),
    ...createOutlookAdapters({ graphClient: createGraphClient(config.microsoft) }),
    ...createCommandCentreAdapters({
      dispatchLinkStore: getConfiguredDispatchLinkStore(databaseUrl),
      invalidate: async () => {
        revalidatePath("/dispatch");
        revalidatePath("/dispatch/queue");
        revalidatePath("/wallboard");
      },
      outcomeStore: createPostgresWorklogOutcomeStore({ databaseUrl }),
      resultReader: repository,
    }),
  };
  const registry = createIntegrationAdapterRegistry(adapters);
  const workerId = integrationWorkerId();
  return {
    processor: createIntegrationProcessor({
      registry,
      repository,
      workerId,
    }),
    repository,
    workerId,
  };
}

function requiredDatabaseUrl(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for integration processing.");
  }
  return databaseUrl.trim();
}

function integrationWorkerId() {
  const region = (process.env.VERCEL_REGION?.trim() || "local").replace(
    /[^A-Za-z0-9._/-]/g,
    "-",
  );
  return `integration-worker:${region}:${crypto.randomUUID()}`.slice(0, 128);
}
