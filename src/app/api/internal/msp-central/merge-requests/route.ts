import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";

type MergeRequestsCommand = {
  childRequestId?: string;
  parentRequestId?: string;
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
    );
    const client = createMspCentralClient(readDispatchConfig());

    await client.mergeRequests(command);

    return noStoreJson({
      childRequestId: command.childRequestId,
      ok: true,
      parentRequestId: command.parentRequestId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Request merge failed.";

    console.error("MSP Central request merge failed", error);

    return noStoreJson({ error: message, ok: false }, { status: 400 });
  }
}

function validateCommand(command: MergeRequestsCommand) {
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
    parentRequestId,
  };
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}
