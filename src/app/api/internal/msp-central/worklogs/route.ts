import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";

type WorklogCommand = {
  complete?: boolean;
  description?: string;
  durationMinutes?: number;
  endedAt?: string;
  requestId?: string;
  startedAt?: string;
};

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const command = validateCommand((await request.json()) as WorklogCommand);
    const client = createMspCentralClient(readDispatchConfig());

    if (!client.addRequestWorklog) {
      throw new Error("MSP Central Work Log writeback is unavailable.");
    }

    await client.addRequestWorklog(command);
    if (command.complete) {
      if (!client.updateRequestStatus) {
        throw new Error("MSP Central status writeback is unavailable.");
      }
      await client.updateRequestStatus({
        requestId: command.requestId,
        status: "Resolved",
      });
    }

    return json({ ok: true }, 200);
  } catch (error) {
    console.error("MSP Central Work Log route failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central Work Log save failed.",
        ok: false,
      },
      400,
    );
  }
}

function validateCommand(command: WorklogCommand) {
  const durationMinutes = Math.round(Number(command.durationMinutes));
  const description = command.description?.trim();
  const requestId = command.requestId?.trim();
  const endedAt = command.endedAt?.trim();
  const startedAt = command.startedAt?.trim();

  if (
    !description ||
    !requestId ||
    !startedAt ||
    !endedAt ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    throw new Error("A request, note, and positive Work Log duration are required.");
  }
  if (
    !Number.isFinite(new Date(startedAt).getTime()) ||
    !Number.isFinite(new Date(endedAt).getTime())
  ) {
    throw new Error("Work Log start and end times are invalid.");
  }

  return {
    complete: Boolean(command.complete),
    description,
    durationMinutes,
    endedAt,
    requestId,
    startedAt,
  };
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}
