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

const INTEGRATION_ROUTE_TIMEOUT_MS = 7_000;

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
    const operations = await withIntegrationTimeout(
      active
        ? canManage
          ? repository.listActiveOperations({ limit: 100 })
          : repository.listActiveOperationsForActor({
              actorEmail: access.email,
              limit: 100,
            })
        : repository.listActionableOperations({ limit: 100 }),
    );
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
    return integrationJson({
      actions: [],
      warning:
        "Failed actions are temporarily unavailable. Existing provider actions are still retained for recovery.",
    });
  }
}

function withIntegrationTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("Integration actions timed out.")),
        INTEGRATION_ROUTE_TIMEOUT_MS,
      ),
    ),
  ]);
}
