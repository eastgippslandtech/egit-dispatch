import {
  integrationJson,
  safeIntegrationSummary,
} from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { dispatchRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request?: Request) {
  if (!(await dispatchRouteAccess())) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const repository = createPostgresIntegrationRepository();
    const active = request
      ? new URL(request.url).searchParams.get("scope") === "active"
      : false;
    const operations = active
      ? await repository.listActiveOperations({ limit: 100 })
      : await repository.listActionableOperations({ limit: 100 });
    return integrationJson({
      actions: operations.map((operation) => ({
        actionType: operation.actionType,
        actorEmail: operation.actorEmail,
        attemptCount: operation.attemptCount,
        createdAt: operation.createdAt,
        id: operation.id,
        lastError: safeIntegrationSummary(operation.lastError),
        requestId: operation.requestId,
        state: operation.state,
        updatedAt: operation.updatedAt,
      })),
    });
  } catch {
    return integrationJson(
      { error: "Failed actions are temporarily unavailable." },
      { status: 503 },
    );
  }
}
