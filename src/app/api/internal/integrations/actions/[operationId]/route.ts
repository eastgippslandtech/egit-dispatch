import {
  integrationJson,
  safeIntegrationSummary,
} from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { dispatchRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  if (!(await dispatchRouteAccess())) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }

  const { operationId } = await context.params;
  try {
    const operation = await createPostgresIntegrationRepository().getOperation(
      operationId,
    );
    return integrationJson({
      operation: {
        actionType: operation.actionType,
        attemptCount: operation.attemptCount,
        createdAt: operation.createdAt,
        id: operation.id,
        lastError: safeIntegrationSummary(operation.lastError),
        requestId: operation.requestId,
        state: operation.state,
        syncedAt: operation.syncedAt,
        updatedAt: operation.updatedAt,
      },
    });
  } catch (error) {
    const notFound =
      error instanceof Error && /not found/i.test(error.message);
    return integrationJson(
      {
        error: notFound
          ? "Integration action was not found."
          : "Integration action status is temporarily unavailable.",
      },
      { status: notFound ? 404 : 503 },
    );
  }
}
