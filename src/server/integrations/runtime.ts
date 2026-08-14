import { revalidatePath, revalidateTag } from "next/cache";

import { readDispatchConfig } from "@/server/dispatch/env";
import { getConfiguredDispatchLinkStore } from "@/server/dispatch/link-store";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";
import { getConfiguredNotificationRepository } from "@/server/notifications/repository";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";

import { createCommandCentreAdapters } from "./adapters/command-centre";
import { createEmailAdapters } from "./adapters/email";
import { createMspCentralAdapters } from "./adapters/msp-central";
import { createOutlookAdapters } from "./adapters/outlook";
import { createPushNotificationAdapters } from "./adapters/push";
import { createIntegrationProcessor } from "./processor";
import { createIntegrationAdapterRegistry } from "./registry";
import { createPostgresIntegrationRepository } from "./repository";

export function createConfiguredIntegrationWorker() {
  const config = readDispatchConfig();
  const databaseUrl = requiredDatabaseUrl(config.databaseUrl);
  const repository = createPostgresIntegrationRepository({ databaseUrl });
  const graphClient = createGraphClient(config.microsoft);
  const adapters = {
    ...createPushNotificationAdapters({
      repository: getConfiguredNotificationRepository(databaseUrl),
    }),
    ...createMspCentralAdapters({ client: createMspCentralClient(config) }),
    ...createOutlookAdapters({ graphClient }),
    ...createEmailAdapters({
      fromUserPrincipalName: config.notificationEmailFrom,
      graphClient,
    }),
    ...createCommandCentreAdapters({
      dispatchLinkStore: getConfiguredDispatchLinkStore(databaseUrl),
      invalidate: async () => {
        revalidateTag("command-centre-dashboard", "max");
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
