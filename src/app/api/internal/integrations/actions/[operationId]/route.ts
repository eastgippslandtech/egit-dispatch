import {
  integrationJson,
  safeIntegrationSummary,
} from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import {
  canManageIntegrationRecovery,
  staffRouteAccess,
} from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  const access = await staffRouteAccess();
  if (!access?.email) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }

  const { operationId } = await context.params;
  try {
    const repository = createPostgresIntegrationRepository();
    const operation = canManageIntegrationRecovery(access.email)
      ? await repository.getOperation(operationId)
      : await repository.getOperationForActor(operationId, access.email);
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
