import { after, NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import type { DispatchTestSyncEventInput } from "@/server/dispatch/test-sync";
import type { BookingType, Priority } from "@/server/dispatch/types";
import type { TravelEstimate } from "@/server/dispatch/travel";
import {
  integrationRouteErrorStatus,
  requireIdempotencyKey,
} from "@/server/integrations/http";
import { scheduleOperation } from "@/server/integrations/operations";
import { createPostgresAtomicScheduleWriter } from "@/server/integrations/schedule-write";
import { wakeIntegrationProcessor } from "@/server/integrations/wake";

type LiveScheduleCommand = {
  appointmentId?: string;
  bookingType?: BookingType;
  crew?: LiveScheduleCrewMember[];
  customer?: string;
  date?: string;
  end?: string;
  eventId?: string;
  idempotencyKey?: string;
  location?: string;
  priority?: Priority;
  previousAssignments?: LiveSchedulePreviousAssignment[];
  requestId?: string;
  requestNumber?: string;
  scheduleAction?: "scheduled" | "rescheduled";
  sourceVersion?: string;
  start?: string;
  subject?: string;
  technicianEmail?: string;
  technicianId?: string;
  technicianMspCentralId?: string;
  technicianName?: string;
  travel?: TravelEstimate;
  userPrincipalName?: string;
};

type LiveScheduleCrewMember = {
  eventId?: string;
  technicianEmail?: string;
  technicianId?: string;
  technicianName?: string;
  travel?: TravelEstimate;
  userPrincipalName?: string;
};

type LiveSchedulePreviousAssignment = {
  eventId?: string;
  technicianId?: string;
  userPrincipalName?: string;
};

type ValidLiveScheduleCommand = ReturnType<typeof validateCommand>;

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
      (await request.json()) as LiveScheduleCommand,
      request,
    );
    const queuedWork = scheduleOperation({
        actorEmail: access.email,
        appointmentId: command.appointmentId,
        bookingType: command.bookingType,
        crew: command.crew.map((member) => ({
          eventId: member.eventId,
          technicianEmail: member.technicianEmail,
          technicianId: member.technicianId,
          technicianName: member.technicianName,
          userPrincipalName: member.userPrincipalName,
        })),
        customer: command.customer,
        date: command.date,
        end: command.end,
        idempotencyKey: command.idempotencyKey,
        lead: {
          eventId: command.eventId,
          mspCentralTechnicianId: command.technicianMspCentralId,
          technicianEmail: command.technicianEmail,
          technicianId: command.technicianId,
          technicianName: command.technicianName,
          userPrincipalName: command.userPrincipalName,
        },
        location: command.location,
        previousAssignments: command.previousAssignments,
        priority: command.priority,
        requestId: command.requestId,
        requestNumber: command.requestNumber,
        sourceVersion: command.sourceVersion,
        start: command.start,
        subject: command.subject,
      });
    const localCommand = {
      ...command,
      date: requiredPayloadString(queuedWork.payload, "date"),
      end: requiredPayloadString(queuedWork.payload, "end"),
      start: requiredPayloadString(queuedWork.payload, "start"),
    };

    const localEvents = localScheduleEvents(localCommand);
    const writer = createPostgresAtomicScheduleWriter({
      databaseUrl: readDispatchConfig().databaseUrl,
    });
    const { operation } = await writer.persist({
      createdBy: access.email,
      events: localEvents,
      operation: queuedWork,
      reconciliation: {
        retainedEventIds: localEvents.map((event) => event.id!),
        scheduleGroupId: command.appointmentId,
      },
    });

    after(() => bestEffortWake(operation.id));

    return noStoreJson(
      {
        appointmentId: command.appointmentId,
        ok: true,
        operationId: operation.id,
        status: operation.state,
      },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Live schedule write failed.";
    console.error("Live dispatch schedule queue failed", error);
    return noStoreJson(
      { error: message, ok: false },
      { status: integrationRouteErrorStatus(error) },
    );
  }
}

function requiredPayloadString(
  payload: Record<string, unknown>,
  key: string,
) {
  const value = payload[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Scheduled ${key} is unavailable.`);
  }
  return value;
}

async function bestEffortWake(operationId: string) {
  try {
    await wakeIntegrationProcessor(operationId);
  } catch (error) {
    console.warn("Schedule remains durably queued after wake-up failure.", {
      message: error instanceof Error ? error.message : "Unknown wake-up error.",
      operationId,
    });
  }
}

function localScheduleEvents(
  command: ValidLiveScheduleCommand,
): DispatchTestSyncEventInput[] {
  const lead = localScheduleEvent({
    appointmentId: command.appointmentId,
    command,
    id: `live-schedule-${command.appointmentId}`,
    technicianId: command.technicianId,
    travel: command.travel,
  });
  return [
    lead,
    ...command.crew.map((member) =>
      localScheduleEvent({
        appointmentId: `${command.appointmentId}-crew-${member.technicianId}`,
        command,
        id: `live-schedule-${command.appointmentId}-crew-${member.technicianId}`,
        role: "crew",
        technicianId: member.technicianId,
        travel: member.travel ?? command.travel,
      }),
    ),
  ];
}

function localScheduleEvent({
  appointmentId,
  command,
  id,
  technicianId,
  travel,
  role = "lead",
}: {
  appointmentId: string;
  command: ValidLiveScheduleCommand;
  id: string;
  technicianId: string;
  travel?: TravelEstimate;
  role?: "crew" | "lead";
}): DispatchTestSyncEventInput {
  return {
    appointmentId,
    bookingType: command.bookingType,
    date: command.date,
    end: command.end,
    eventType: command.scheduleAction,
    id,
    payload: {
      liveSync: { status: "pending" },
      scheduleAssignment: {
        assignmentKey: `${command.appointmentId}:${technicianId}`,
        groupId: command.appointmentId,
        role,
      },
      travel,
    },
    priority: command.priority,
    requestId: command.requestId,
    start: command.start,
    technicianId,
  };
}

function validateCommand(command: LiveScheduleCommand, request: Request) {
  const missing = [
    command.appointmentId ? undefined : "appointmentId",
    command.date ? undefined : "date",
    command.end ? undefined : "end",
    command.requestId ? undefined : "requestId",
    command.requestNumber ? undefined : "requestNumber",
    command.start ? undefined : "start",
    command.subject ? undefined : "subject",
    command.technicianId ? undefined : "technicianId",
    command.userPrincipalName ? undefined : "userPrincipalName",
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) {
    throw new Error(`Missing live schedule fields: ${missing.join(", ")}`);
  }

  const crew = (command.crew ?? []).map((member) => ({
    eventId: clean(member.eventId),
    technicianEmail: clean(member.technicianEmail),
    technicianId: clean(member.technicianId),
    technicianName: clean(member.technicianName),
    travel: member.travel,
    userPrincipalName: clean(member.userPrincipalName),
  }));
  if (crew.some((member) => !member.technicianId || !member.userPrincipalName)) {
    throw new Error("Every crew member requires a technician and Outlook calendar.");
  }
  const technicianIds = [
    command.technicianId,
    ...crew.map((member) => member.technicianId),
  ];
  if (new Set(technicianIds).size !== technicianIds.length) {
    throw new Error("A technician can only be selected once.");
  }

  const previousAssignments = (command.previousAssignments ?? [])
    .map((assignment) => ({
      eventId: clean(assignment.eventId),
      technicianId: clean(assignment.technicianId),
      userPrincipalName: clean(assignment.userPrincipalName),
    }))
    .filter(
      (assignment): assignment is {
        eventId: string;
        technicianId: string;
        userPrincipalName: string;
      } => Boolean(
        assignment.eventId &&
          assignment.technicianId &&
          assignment.userPrincipalName,
      ),
    );

  return {
    appointmentId: command.appointmentId!,
    bookingType: validBookingType(command.bookingType),
    crew: crew as Array<{
      eventId?: string;
      technicianEmail?: string;
      technicianId: string;
      technicianName?: string;
      travel?: TravelEstimate;
      userPrincipalName: string;
    }>,
    customer: clean(command.customer),
    date: command.date!,
    end: command.end!,
    eventId: clean(command.eventId),
    idempotencyKey: requireIdempotencyKey(request, command.idempotencyKey),
    location: clean(command.location),
    previousAssignments,
    priority: validPriority(command.priority),
    requestId: command.requestId!,
    requestNumber: command.requestNumber!,
    scheduleAction:
      command.scheduleAction === "rescheduled" ? "rescheduled" as const : "scheduled" as const,
    sourceVersion: clean(command.sourceVersion),
    start: command.start!,
    subject: command.subject!,
    technicianEmail: clean(command.technicianEmail),
    technicianId: command.technicianId!,
    technicianMspCentralId: clean(command.technicianMspCentralId),
    technicianName: clean(command.technicianName),
    travel: command.travel,
    userPrincipalName: command.userPrincipalName!,
  };
}

function validBookingType(value?: BookingType) {
  return value === "Remote" || value === "Onsite" || value === "In house"
    ? value
    : undefined;
}

function validPriority(value?: Priority) {
  return value === "Critical" || value === "High" || value === "Medium" || value === "Low"
    ? value
    : undefined;
}

function clean(value?: string) {
  return value?.trim() || undefined;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}
