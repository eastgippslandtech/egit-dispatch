import { after, NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import {
  integrationRouteErrorStatus,
  requireIdempotencyKey,
} from "@/server/integrations/http";
import { communicationOperation } from "@/server/integrations/operations";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const requestId = decodeURIComponent((await params).requestId).trim();
    const input = (await request.json()) as {
      idempotencyKey?: string;
      message?: string;
      occurredAt?: string;
      sourceVersion?: string;
      visibility?: "customer" | "internal";
    };
    const message = input.message?.trim() ?? "";
    const occurredAt = input.occurredAt?.trim() ?? "";
    const visibility = input.visibility === "internal" ? "internal" : "customer";
    const idempotencyKey = requireIdempotencyKey(request, input.idempotencyKey);
    if (!requestId || !message) {
      return json({ error: "A request and message are required." }, 400);
    }
    if (!Number.isFinite(new Date(occurredAt).getTime())) {
      return json({ error: "A valid message timestamp is required." }, 400);
    }

    const repository = createPostgresIntegrationRepository({
      databaseUrl: readDispatchConfig().databaseUrl,
    });
    const { operation } = await repository.enqueue(
      communicationOperation({
        actorEmail: access.email,
        body: message,
        idempotencyKey,
        occurredAt,
        requestId,
        sourceVersion: input.sourceVersion?.trim() || undefined,
        visibility,
      }),
    );
    after(() => bestEffortWake(operation.id));

    return json(
      { ok: true, operationId: operation.id, status: operation.state },
      202,
    );
  } catch (error) {
    console.error("MSP Central communication queue failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central communication could not be queued.",
      },
      integrationRouteErrorStatus(error),
    );
  }
}

async function bestEffortWake(operationId: string) {
  try {
    await wakeIntegrationProcessor(operationId);
  } catch (error) {
    console.warn("Communication remains durably queued after wake-up failure.", {
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
