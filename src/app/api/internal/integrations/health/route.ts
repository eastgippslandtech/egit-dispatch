import {
  integrationJson,
  safeIntegrationSummary,
} from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import type {
  IntegrationConnectorHealth,
} from "@/server/integrations/types";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INTEGRATION_ROUTE_TIMEOUT_MS = 6_500;

export async function GET() {
  if (!(await staffRouteAccess())) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const repository = createPostgresIntegrationRepository();
    const [connectorsResult, countsResult] = await Promise.all([
      withIntegrationFallback(
        repository.getHealth(),
        unknownHealth("Integration health timed out."),
        "Integration health timed out.",
      ),
      withIntegrationFallback(
        repository.getOperationCounts(),
        { pending: 0, reviewRequired: 0 },
        "Integration recovery counts timed out.",
      ),
    ]);
    const warning = [connectorsResult.warning, countsResult.warning]
      .filter(Boolean)
      .join(" ");
    return integrationJson({
      connectors: connectorsResult.value.map((connector) => ({
        ...connector,
        lastError: safeIntegrationSummary(connector.lastError),
      })),
      counts: countsResult.value,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    return integrationJson({
      connectors: unavailableHealth(
        error instanceof Error
          ? error.message
          : "Integration health is temporarily unavailable.",
      ),
      counts: { pending: 0, reviewRequired: 0 },
      warning:
        "Integration health is temporarily unavailable. Provider actions are still retained for recovery.",
    });
  }
}

function unavailableHealth(error: string): IntegrationConnectorHealth[] {
  return [
    {
      connector: "command_centre",
      consecutiveFailures: 1,
      lastCheckedAt: new Date().toISOString(),
      lastError: safeIntegrationSummary(error),
      status: "unavailable",
    },
  ];
}

function unknownHealth(error: string): IntegrationConnectorHealth[] {
  return [
    {
      connector: "msp_central",
      consecutiveFailures: 0,
      lastCheckedAt: new Date().toISOString(),
      lastError: safeIntegrationSummary(error),
      status: "unknown",
    },
    {
      connector: "outlook",
      consecutiveFailures: 0,
      lastCheckedAt: new Date().toISOString(),
      lastError: safeIntegrationSummary(error),
      status: "unknown",
    },
  ];
}

async function withIntegrationFallback<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMessage: string,
): Promise<{ value: T; warning?: string }> {
  try {
    return {
      value: await Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error(timeoutMessage)),
            INTEGRATION_ROUTE_TIMEOUT_MS,
          ),
        ),
      ]),
    };
  } catch (error) {
    return {
      value: fallback,
      warning: safeIntegrationSummary(
        error instanceof Error ? error.message : timeoutMessage,
      ),
    };
  }
}
