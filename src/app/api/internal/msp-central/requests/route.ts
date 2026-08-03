import { after, NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import type { Priority } from "@/server/dispatch/types";
import {
  integrationRouteErrorStatus,
  requireIdempotencyKey,
} from "@/server/integrations/http";
import { createRequestOperation } from "@/server/integrations/operations";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

export const dynamic = "force-dynamic";

const priorities = new Set<Priority>(["Critical", "High", "Medium", "Low"]);

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const input = (await request.json()) as {
      customer?: string;
      description?: string;
      idempotencyKey?: string;
      priority?: Priority;
      requesterEmail?: string;
      site?: string;
      sourceVersion?: string;
      subject?: string;
    };
    const subject = input.subject?.trim() ?? "";
    const idempotencyKey = requireIdempotencyKey(request, input.idempotencyKey);
    const priority = priorities.has(input.priority ?? "Medium")
      ? (input.priority ?? "Medium")
      : "Medium";
    if (!subject) return json({ error: "Subject is required." }, 400);

    const repository = createPostgresIntegrationRepository({
      databaseUrl: readDispatchConfig().databaseUrl,
    });
    const { operation } = await repository.enqueue(
      createRequestOperation({
        actorEmail: access.email,
        customer: input.customer?.trim(),
        description: input.description?.trim(),
        idempotencyKey,
        priority,
        requesterEmail: input.requesterEmail?.trim(),
        site: input.site?.trim(),
        sourceVersion: input.sourceVersion?.trim() || undefined,
        subject,
      }),
    );
    after(() => bestEffortWake(operation.id));

    return json(
      {
        ok: true,
        operationId: operation.id,
        pendingRequestId: operation.requestId,
        status: operation.state,
      },
      202,
    );
  } catch (error) {
    console.error("MSP Central request creation queue failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central request could not be queued.",
      },
      integrationRouteErrorStatus(error),
    );
  }
}

async function bestEffortWake(operationId: string) {
  try {
    await wakeIntegrationProcessor(operationId);
  } catch (error) {
    console.warn("Request creation remains durably queued after wake-up failure.", {
      message: error instanceof Error ? error.message : "Unknown wake-up error.",
      operationId,
    });
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}
