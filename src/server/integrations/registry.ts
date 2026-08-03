import { PermanentIntegrationError } from "./errors";
import type { IntegrationOperationStep } from "./types";

export type IntegrationStepResult = Record<string, unknown> & {
  externalId?: string;
  externalVersion?: string;
};

export type IntegrationStepAdapter = {
  execute(step: IntegrationOperationStep): Promise<IntegrationStepResult>;
  writeSafety?: "idempotent" | "non_idempotent";
};

export type IntegrationAdapterRegistry = ReturnType<
  typeof createIntegrationAdapterRegistry
>;

export function createIntegrationAdapterRegistry(
  adapters: Record<string, IntegrationStepAdapter>,
) {
  const registered = new Map(Object.entries(adapters));
  return {
    get(action: string) {
      const adapter = registered.get(action);
      if (!adapter) {
        throw new PermanentIntegrationError(
          `No integration adapter is registered for ${action}.`,
        );
      }
      return adapter;
    },
  };
}

