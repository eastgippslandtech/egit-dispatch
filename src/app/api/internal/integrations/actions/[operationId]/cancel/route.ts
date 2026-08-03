import { integrationJson } from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { dispatchRouteAccess } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  const access = await dispatchRouteAccess();
  if (!access?.email) {
    return integrationJson({ error: "Unauthorized." }, { status: 401 });
  }
  const { operationId } = await context.params;
  try {
    const operation = await createPostgresIntegrationRepository()
      .cancelOperationWithAudit({ actorEmail: access.email, operationId });
    return integrationJson({ operationId: operation.id, status: operation.state });
  } catch (error) {
    const conflict = isConflict(error);
    return integrationJson(
      {
        error: conflict
          ? "This action is currently syncing, already synced, or otherwise not cancellable."
          : "The integration action could not be cancelled.",
      },
      { status: conflict ? 409 : 503 },
    );
  }
}

function isConflict(error: unknown) {
  return (
    error instanceof Error &&
    /in flight|not cancellable|already synced|not found|syncing|processing/i.test(
      error.message,
    )
  );
}
