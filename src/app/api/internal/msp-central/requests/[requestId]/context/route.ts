import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
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
    if (!requestId) {
      return json({ error: "Request ID is required." }, 400);
    }

    const context = await createMspCentralClient(
      readDispatchConfig(),
    ).getRequestContext(requestId);
    return json(context, 200);
  } catch (error) {
    console.error("MSP Central request context route failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Latest ticket information could not be loaded.",
      },
      400,
    );
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}
