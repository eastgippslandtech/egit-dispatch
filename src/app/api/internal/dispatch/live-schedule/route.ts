import { after, NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { getConfiguredDispatchLinkStore } from "@/server/dispatch/link-store";
import { cleanRequestTitle } from "@/server/dispatch/request-title";
import {
  recordDispatchTestSyncEvent,
  type DispatchTestSyncEventInput,
} from "@/server/dispatch/test-sync";
import type {
  BookingType,
  Priority,
} from "@/server/dispatch/types";
import type { TravelEstimate } from "@/server/dispatch/travel";
import { createGraphClient } from "@/server/graph/client";
import { createMspCentralClient } from "@/server/msp-central/client";

type LiveScheduleCommand = {
  appointmentId?: string;
  bookingType?: BookingType;
  crew?: LiveScheduleCrewMember[];
  customer?: string;
  date?: string;
  end?: string;
  eventId?: string;
  location?: string;
  priority?: Priority;
  previousAssignments?: LiveSchedulePreviousAssignment[];
  requestId?: string;
  requestNumber?: string;
  scheduleAction?: "scheduled" | "rescheduled";
  start?: string;
  subject?: string;
  technicianId?: string;
  technicianName?: string;
  technicianEmail?: string;
  technicianMspCentralId?: string;
  travel?: TravelEstimate;
  userPrincipalName?: string;
};

type LiveScheduleCrewMember = {
  eventId?: string;
  technicianEmail?: string;
  technicianId?: string;
  technicianName?: string;
  userPrincipalName?: string;
};

type LiveSchedulePreviousAssignment = {
  eventId?: string;
  technicianId?: string;
  userPrincipalName?: string;
};

type ValidLiveScheduleCommand = ReturnType<typeof validateCommand>;
type LiveSyncState = NonNullable<
  NonNullable<DispatchTestSyncEventInput["payload"]>["liveSync"]
>;

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
    const eventId = `live-schedule-${command.appointmentId}`;

    await recordDispatchTestSyncEvent(
      localScheduleEvent(command, eventId, { status: "pending" }),
      access.email,
    );

    after(() => runBackgroundScheduleSync(command, eventId, access.email));

    return noStoreJson(
      {
        appointmentId: command.appointmentId,
        ok: true,
        queued: true,
      },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Live schedule write failed.";

    console.error("Live dispatch schedule queue failed", error);

    return noStoreJson({ error: message, ok: false }, { status: 400 });
  }
}

async function runBackgroundScheduleSync(
  command: ValidLiveScheduleCommand,
  eventId: string,
  createdBy: string,
) {
  const config = readDispatchConfig();
  const graphClient = createGraphClient({
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    tenantId: config.microsoft.tenantId,
    timezone: config.microsoft.timezone,
  });
  const mspClient = createMspCentralClient(config);
  const linkStore = getConfiguredDispatchLinkStore(config.databaseUrl);
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
    subject:
      cleanRequestTitle(command.subject, command.requestNumber) ||
      "Command Centre booking",
    userPrincipalName: command.userPrincipalName,
  };
  const graphInputs = [
    {
      eventId: command.eventId,
      technicianEmail: command.technicianEmail,
      technicianId: command.technicianId,
      userPrincipalName: command.userPrincipalName,
    },
    ...command.crew,
  ];
  const [mspResult, ...graphResults] = await Promise.allSettled([
    mspClient.updateRequestSchedule({
      requestId: command.requestId,
      scheduledEnd: `${command.date}T${command.end}:00${melbourneOffset(command.date)}`,
      scheduledStart: `${command.date}T${command.start}:00${melbourneOffset(command.date)}`,
      technicianEmail: command.technicianEmail,
      technicianId: command.technicianMspCentralId,
      technicianName: command.technicianName,
    }),
    ...graphInputs.map((assignment) => {
      const assignmentInput = {
        ...graphInput,
        userPrincipalName: assignment.userPrincipalName,
      };
      return assignment.eventId
        ? graphClient.updateEvent({
            ...assignmentInput,
            eventId: assignment.eventId,
          })
        : graphClient.createEvent(assignmentInput);
    }),
  ]);
  const leadGraphResult = graphResults[0];
  const graphEvent =
    leadGraphResult?.status === "fulfilled" ? leadGraphResult.value : undefined;
  const crewGraphResults = graphResults.slice(1);
  const selectedTechnicianIds = new Set(
    graphInputs.map((assignment) => assignment.technicianId),
  );
  const removedAssignments = command.previousAssignments.filter(
    (assignment) => !selectedTechnicianIds.has(assignment.technicianId),
  );
  const removedResults = await Promise.allSettled(
    removedAssignments.map((assignment) =>
      graphClient.deleteEvent({
        eventId: assignment.eventId,
        userPrincipalName: assignment.userPrincipalName,
      }),
    ),
  );
  const errors = [
    mspResult.status === "rejected"
      ? `MSP Central: ${errorMessage(mspResult.reason)}`
      : undefined,
    leadGraphResult?.status === "rejected"
      ? `Outlook (${command.technicianName ?? "lead"}): ${errorMessage(leadGraphResult.reason)}`
      : undefined,
    ...crewGraphResults.map((result, index) =>
      result.status === "rejected"
        ? `Outlook (${command.crew[index]?.technicianName ?? "crew"}): ${errorMessage(result.reason)}`
        : undefined,
    ),
    ...removedResults.map((result, index) =>
      result.status === "rejected"
        ? `Outlook cleanup (${removedAssignments[index]?.userPrincipalName}): ${errorMessage(result.reason)}`
        : undefined,
    ),
  ].filter((message): message is string => Boolean(message));
  const persistedOutlookEventId = graphEvent?.id ?? command.eventId;

  if (linkStore) {
    try {
      await linkStore.save({
        action: "live_schedule",
        bookingType: command.bookingType,
        crew: command.crew.map((member, index) => {
          const result = crewGraphResults[index];
          const event = result?.status === "fulfilled" ? result.value : undefined;
          return {
            outlookCalendarEmail: member.userPrincipalName,
            outlookEventId: event?.id ?? member.eventId,
            syncError:
              result?.status === "rejected" ? errorMessage(result.reason) : undefined,
            syncStatus:
              result?.status === "fulfilled" ? ("linked" as const) : ("failed" as const),
            technicianEmail: member.technicianEmail,
            technicianId: member.technicianId,
          };
        }),
        customer: command.customer,
        outlookCalendarEmail: command.userPrincipalName,
        outlookEventId: persistedOutlookEventId,
        priority: command.priority,
        requestId: command.requestId,
        requestNumber: command.requestNumber,
        scheduledEnd: `${command.date}T${command.end}:00${melbourneOffset(command.date)}`,
        scheduledStart: `${command.date}T${command.start}:00${melbourneOffset(command.date)}`,
        siteAddress: command.location,
        siteName: command.location,
        subject: command.subject,
        syncError: errors.join(" ") || undefined,
        syncStatus: scheduleSyncStatus({ graphResults, mspResult }),
        technicianEmail: command.technicianEmail,
        technicianId: command.technicianId,
        technicianMspCentralId: command.technicianMspCentralId,
      });
    } catch (error) {
      errors.push(`Command Centre: ${errorMessage(error)}`);
    }
  }
  const liveSync: LiveSyncState =
    errors.length > 0
      ? {
          error: errors.join(" "),
          outlookEventId: graphEvent?.id,
          outlookWebLink: graphEvent?.webLink,
          status: "failed",
        }
      : {
          outlookEventId: graphEvent?.id,
          outlookWebLink: graphEvent?.webLink,
          status: "synced",
        };

  try {
    await recordDispatchTestSyncEvent(
      localScheduleEvent(command, eventId, liveSync),
      createdBy,
    );
  } catch (error) {
    console.error("Live dispatch schedule result persistence failed", {
      message: errorMessage(error),
      requestId: command.requestId,
    });
  }

  if (errors.length > 0) {
    console.error("Live dispatch background sync failed", {
      errors,
      requestId: command.requestId,
    });
  }
}

function scheduleSyncStatus({
  graphResults,
  mspResult,
}: {
  graphResults: PromiseSettledResult<unknown>[];
  mspResult: PromiseSettledResult<unknown>;
}) {
  const graphSucceeded = graphResults.every(
    (result) => result.status === "fulfilled",
  );
  if (graphSucceeded && mspResult.status === "fulfilled") {
    return "linked" as const;
  }
  if (mspResult.status === "fulfilled") {
    return "sdp_only" as const;
  }
  if (graphSucceeded) {
    return "needs_review" as const;
  }
  return "failed" as const;
}

function localScheduleEvent(
  command: ValidLiveScheduleCommand,
  id: string,
  liveSync: LiveSyncState,
): DispatchTestSyncEventInput {
  return {
    appointmentId: command.appointmentId,
    bookingType: command.bookingType,
    date: command.date,
    end: command.end,
    eventType: command.scheduleAction,
    id,
    payload: {
      liveSync,
      travel: command.travel,
    },
    priority: command.priority,
    requestId: command.requestId,
    start: command.start,
    technicianId: command.technicianId,
  };
}

function validateCommand(command: LiveScheduleCommand) {
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
    userPrincipalName: clean(member.userPrincipalName),
  }));
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
      } =>
        Boolean(
          assignment.eventId &&
            assignment.technicianId &&
            assignment.userPrincipalName,
        ),
    );
  if (
    crew.some(
      (member) => !member.technicianId || !member.userPrincipalName,
    )
  ) {
    throw new Error("Every crew member requires a technician and Outlook calendar.");
  }
  const selectedTechnicianIds = [
    command.technicianId,
    ...crew.map((member) => member.technicianId),
  ];
  if (new Set(selectedTechnicianIds).size !== selectedTechnicianIds.length) {
    throw new Error("A technician can only be selected once.");
  }

  return {
    appointmentId: command.appointmentId as string,
    bookingType: validBookingType(command.bookingType),
    crew: crew as Array<{
      eventId?: string;
      technicianEmail?: string;
      technicianId: string;
      technicianName?: string;
      userPrincipalName: string;
    }>,
    customer: clean(command.customer),
    date: command.date as string,
    end: command.end as string,
    eventId: clean(command.eventId),
    location: clean(command.location),
    priority: validPriority(command.priority),
    previousAssignments,
    requestId: command.requestId as string,
    requestNumber: command.requestNumber as string,
    scheduleAction:
      command.scheduleAction === "rescheduled"
        ? ("rescheduled" as const)
        : ("scheduled" as const),
    start: command.start as string,
    subject: command.subject as string,
    technicianId: command.technicianId as string,
    technicianName: clean(command.technicianName),
    technicianEmail: clean(command.technicianEmail),
    technicianMspCentralId: clean(command.technicianMspCentralId),
    travel: command.travel,
    userPrincipalName: command.userPrincipalName as string,
  };
}

function validBookingType(value?: BookingType) {
  return value === "Remote" || value === "Onsite" || value === "In house"
    ? value
    : undefined;
}

function validPriority(value?: Priority) {
  return value === "Critical" ||
    value === "High" ||
    value === "Medium" ||
    value === "Low"
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown sync error.";
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
