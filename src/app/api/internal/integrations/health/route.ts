import {
  integrationJson,
  safeIntegrationSummary,
} from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INTEGRATION_ROUTE_TIMEOUT_MS = 7_000;

export async function GET() {
  if (!(await staffRouteAccess())) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const repository = createPostgresIntegrationRepository();
    const [connectors, counts] = await withIntegrationTimeout(
      Promise.all([
        repository.getHealth(),
        repository.getOperationCounts(),
      ]),
    );
    return integrationJson({
      connectors: connectors.map((connector) => ({
        ...connector,
        lastError: safeIntegrationSummary(connector.lastError),
      })),
      counts,
    });
  } catch (error) {
    return integrationJson({
      connectors: [
        {
          connector: "command_centre",
          consecutiveFailures: 1,
          lastCheckedAt: new Date().toISOString(),
          lastError: safeIntegrationSummary(
            error instanceof Error
              ? error.message
              : "Integration health is temporarily unavailable.",
          ),
          status: "unavailable",
        },
      ],
      counts: { pending: 0, reviewRequired: 0 },
      warning:
        "Integration health is temporarily unavailable. Provider actions are still retained for recovery.",
    });
  }
}

function withIntegrationTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("Integration health timed out.")),
        INTEGRATION_ROUTE_TIMEOUT_MS,
      ),
    ),
  ]);
}
