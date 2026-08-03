import {
  integrationJson,
  safeIntegrationSummary,
} from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { staffRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await staffRouteAccess())) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const repository = createPostgresIntegrationRepository();
    const [connectors, counts] = await Promise.all([
      repository.getHealth(),
      repository.getOperationCounts(),
    ]);
    return integrationJson({
      connectors: connectors.map((connector) => ({
        ...connector,
        lastError: safeIntegrationSummary(connector.lastError),
      })),
      counts,
    });
  } catch {
    return integrationJson(
      { error: "Integration health is temporarily unavailable." },
      { status: 503 },
    );
  }
}
