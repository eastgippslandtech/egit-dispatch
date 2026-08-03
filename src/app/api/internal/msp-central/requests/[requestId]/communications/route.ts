import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";

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
      message?: string;
      visibility?: "customer" | "internal";
    };
    const message = input.message?.trim() ?? "";
    const visibility = input.visibility === "internal" ? "internal" : "customer";
    if (!requestId || !message) {
      return json({ error: "A request and message are required." }, 400);
    }

    const client = createMspCentralClient(readDispatchConfig());
    if (!client.addRequestNote) {
      return json({ error: "MSP Central communications are unavailable." }, 503);
    }
    await client.addRequestNote({ description: message, requestId, visibility });
    try {
      const context = await client.getRequestContext(requestId);
      return json({ context, ok: true, stale: false }, 200);
    } catch (refreshError) {
      const refreshWarning =
        refreshError instanceof Error
          ? refreshError.message
          : "The message saved, but the refreshed ticket could not be loaded.";
      console.warn("MSP Central communication saved with stale context", refreshError);
      return json(
        { context: null, ok: true, refreshWarning, stale: true },
        200,
      );
    }
  } catch (error) {
    console.error("MSP Central communication route failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central communication could not be saved.",
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
