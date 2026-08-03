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
import { mergeOperation } from "@/server/integrations/operations";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

type MergeRequestsCommand = {
  childRequestId?: string;
  idempotencyKey?: string;
  parentRequestId?: string;
  sourceVersion?: string;
};

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }
  if (!isApprovedStaffAccess(access)) {
    return noStoreJson({ error: "Access not approved." }, { status: 403 });
  }

  try {
    const command = validateCommand(
      (await request.json()) as MergeRequestsCommand,
      request,
    );
    const repository = createPostgresIntegrationRepository({
      databaseUrl: readDispatchConfig().databaseUrl,
    });
    const { operation } = await repository.enqueue(
      mergeOperation({
        actorEmail: access.email,
        ...command,
      }),
    );
    after(() => bestEffortWake(operation.id));

    return noStoreJson(
      {
        childRequestId: command.childRequestId,
        ok: true,
        operationId: operation.id,
        parentRequestId: command.parentRequestId,
        status: operation.state,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request merge failed.";
    console.error("MSP Central request merge queue failed", error);
    return noStoreJson(
      { error: message, ok: false },
      { status: integrationRouteErrorStatus(error) },
    );
  }
}

function validateCommand(command: MergeRequestsCommand, request: Request) {
  const childRequestId = command.childRequestId?.trim();
  const parentRequestId = command.parentRequestId?.trim();
  if (!childRequestId || !parentRequestId) {
    throw new Error("Both duplicate and surviving request IDs are required.");
  }
  if (childRequestId === parentRequestId) {
    throw new Error("A request cannot be merged into itself.");
  }
  return {
    childRequestId,
    idempotencyKey: requireIdempotencyKey(request, command.idempotencyKey),
    parentRequestId,
    sourceVersion: command.sourceVersion?.trim() || undefined,
  };
}

async function bestEffortWake(operationId: string) {
  try {
    await wakeIntegrationProcessor(operationId);
  } catch (error) {
    console.warn("Merge remains durably queued after wake-up failure.", {
      message: error instanceof Error ? error.message : "Unknown wake-up error.",
      operationId,
    });
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}
