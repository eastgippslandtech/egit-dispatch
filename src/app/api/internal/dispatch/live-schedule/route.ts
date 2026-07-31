import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import type { BookingType } from "@/server/dispatch/types";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";

type LiveScheduleCommand = {
  bookingType?: BookingType;
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
  technicianEmail?: string;
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
    const liveRequest = await mspClient.getRequest(command.requestId);

    if (!liveRequest || liveRequest.sourceSystem !== "msp-central") {
      throw new Error(
        "The Helpdesk request no longer exists. Refresh Command Centre before scheduling it.",
      );
    }

    const graphInput = {
      bodyPreview: [
        `Request: ${command.requestNumber}`,
        command.customer ? `Company: ${command.customer}` : undefined,
        command.location ? `Site: ${command.location}` : undefined,
        command.bookingType ? `Booking Type: ${command.bookingType}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      end: `${command.date}T${command.end}:00`,
      location: command.location,
      start: `${command.date}T${command.start}:00`,
      subject: `${command.requestNumber} ${command.subject}`.trim(),
      userPrincipalName: command.userPrincipalName,
    };
    await mspClient.updateRequestSchedule({
      requestId: command.requestId,
      scheduledEnd: `${command.date}T${command.end}:00${melbourneOffset(command.date)}`,
      scheduledStart: `${command.date}T${command.start}:00${melbourneOffset(command.date)}`,
      technicianEmail: command.technicianEmail,
      technicianName: command.technicianName,
    });

    const event = command.eventId
      ? await graphClient.updateEvent({
          ...graphInput,
          eventId: command.eventId,
        })
      : await graphClient.createEvent(graphInput);

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
    bookingType: validBookingType(command.bookingType),
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
    technicianEmail: clean(command.technicianEmail),
    userPrincipalName: command.userPrincipalName as string,
  };
}

function validBookingType(value?: BookingType) {
  return value === "Remote" || value === "Onsite" || value === "In house"
    ? value
    : undefined;
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
