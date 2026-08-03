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

export async function GET(request?: Request) {
  const access = await staffRouteAccess();
  if (!access?.email) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }
  const canManage = canManageIntegrationRecovery(access.email);
  const active = request
    ? new URL(request.url).searchParams.get("scope") === "active"
    : false;
  if (!canManage && !active) {
    return integrationJson({ error: "Forbidden." }, { status: 403 });
  }
  try {
    const repository = createPostgresIntegrationRepository();
    const operations = active
      ? canManage
        ? await repository.listActiveOperations({ limit: 100 })
        : await repository.listActiveOperationsForActor({
            actorEmail: access.email,
            limit: 100,
          })
      : await repository.listActionableOperations({ limit: 100 });
    return integrationJson({
      actions: operations.map((operation) =>
        canManage
          ? {
              actionType: operation.actionType,
              actorEmail: operation.actorEmail,
              attemptCount: operation.attemptCount,
              createdAt: operation.createdAt,
              id: operation.id,
              lastError: safeIntegrationSummary(operation.lastError),
              requestId: operation.requestId,
              state: operation.state,
              updatedAt: operation.updatedAt,
            }
          : {
              id: operation.id,
              requestId: operation.requestId,
              state: operation.state,
            },
      ),
    });
  } catch {
    return integrationJson(
      { error: "Failed actions are temporarily unavailable." },
      { status: 503 },
    );
  }
}
