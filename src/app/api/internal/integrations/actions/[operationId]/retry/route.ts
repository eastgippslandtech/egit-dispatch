import { after } from "next/server";

import { integrationJson } from "@/server/integrations/http";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";
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
      .retryOperationWithAudit({ actorEmail: access.email, operationId });
    after(() => wakeIntegrationProcessor(operation.id).catch(() => undefined));
    return integrationJson(
      { operationId: operation.id, status: operation.state },
      { status: 202 },
    );
  } catch (error) {
    return integrationJson(
      {
        error: isConflict(error)
          ? "Only review-required actions can be retried."
          : "The integration action could not be retried.",
      },
      { status: isConflict(error) ? 409 : 503 },
    );
  }
}

function isConflict(error: unknown) {
  return error instanceof Error && /not ready|not found|review/i.test(error.message);
}
