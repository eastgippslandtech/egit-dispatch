import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createGraphClient } from "@/server/graph/client";
import type { MicrosoftGraphEventUpdate } from "@/server/graph/types";

type GraphEventCommand = Partial<MicrosoftGraphEventUpdate>;

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();

  if (access.status === "unauthenticated") {
    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }

  if (!isApprovedStaffAccess(access)) {
    return noStoreJson({ error: "Access not approved." }, { status: 403 });
  }

  try {
    const command = validateCommand((await request.json()) as GraphEventCommand);
    const config = readDispatchConfig();
    const client = createGraphClient({
      clientId: config.microsoft.clientId,
      clientSecret: config.microsoft.clientSecret,
      tenantId: config.microsoft.tenantId,
      timezone: config.microsoft.timezone,
    });
    const event = command.eventId
      ? await client.updateEvent(command as MicrosoftGraphEventUpdate)
      : await client.createEvent(command);

    return noStoreJson({ event, ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Outlook calendar write failed.";

    console.error("Outlook calendar write route failed", error);

    return noStoreJson({ error: message, ok: false }, { status: 400 });
  }
}

function validateCommand(command: GraphEventCommand) {
  const missing = [
    command.userPrincipalName ? undefined : "userPrincipalName",
    command.subject ? undefined : "subject",
    command.start ? undefined : "start",
    command.end ? undefined : "end",
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(`Missing Outlook event fields: ${missing.join(", ")}`);
  }

  return {
    bodyPreview: clean(command.bodyPreview),
    end: command.end as string,
    eventId: clean(command.eventId),
    location: clean(command.location),
    start: command.start as string,
    subject: command.subject as string,
    userPrincipalName: command.userPrincipalName as string,
  };
}

function clean(value?: string) {
  return value?.trim() || undefined;
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
