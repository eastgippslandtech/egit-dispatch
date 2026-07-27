import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";

type LiveScheduleCommand = {
  customer?: string;
  date?: string;
  end?: string;
  eventId?: string;
  location?: string;
  requestId?: string;
  requestNumber?: string;
  start?: string;
  subject?: string;
  technicianName?: string;
  userPrincipalName?: string;
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
    const command = validateCommand((await request.json()) as LiveScheduleCommand);
    const config = readDispatchConfig();
    const graphClient = createGraphClient({
      clientId: config.microsoft.clientId,
      clientSecret: config.microsoft.clientSecret,
      tenantId: config.microsoft.tenantId,
      timezone: config.microsoft.timezone,
    });
    const mspClient = createMspCentralClient(config);
    const graphInput = {
      bodyPreview: [
        command.requestNumber,
        command.customer,
        command.location,
      ]
        .filter(Boolean)
        .join("\n"),
      end: `${command.date}T${command.end}:00`,
      location: command.location,
      start: `${command.date}T${command.start}:00`,
      subject: `${command.requestNumber} ${command.subject}`.trim(),
      userPrincipalName: command.userPrincipalName,
    };
    const event = command.eventId
      ? await graphClient.updateEvent({
          ...graphInput,
          eventId: command.eventId,
        })
      : await graphClient.createEvent(graphInput);

    await mspClient.updateRequestSchedule({
      requestId: command.requestId,
      scheduledEnd: `${command.date}T${command.end}:00${melbourneOffset(command.date)}`,
      scheduledStart: `${command.date}T${command.start}:00${melbourneOffset(command.date)}`,
      technicianName: command.technicianName,
    });

    return noStoreJson({ event, ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Live schedule write failed.";

    console.error("Live dispatch schedule route failed", error);

    return noStoreJson({ error: message, ok: false }, { status: 400 });
  }
}

function validateCommand(command: LiveScheduleCommand) {
  const missing = [
    command.date ? undefined : "date",
    command.end ? undefined : "end",
    command.requestId ? undefined : "requestId",
    command.requestNumber ? undefined : "requestNumber",
    command.start ? undefined : "start",
    command.subject ? undefined : "subject",
    command.userPrincipalName ? undefined : "userPrincipalName",
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(`Missing live schedule fields: ${missing.join(", ")}`);
  }

  return {
    customer: clean(command.customer),
    date: command.date as string,
    end: command.end as string,
    eventId: clean(command.eventId),
    location: clean(command.location),
    requestId: command.requestId as string,
    requestNumber: command.requestNumber as string,
    start: command.start as string,
    subject: command.subject as string,
    technicianName: clean(command.technicianName),
    userPrincipalName: command.userPrincipalName as string,
  };
}

function melbourneOffset(date: string) {
  const month = Number(date.slice(5, 7));

  return month >= 4 && month <= 9 ? "+10:00" : "+11:00";
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
