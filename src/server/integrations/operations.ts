import type { BookingType, Priority } from "@/server/dispatch/types";
import type {
  WorklogDispositionCommand,
} from "@/server/worklogs/disposition";
import { roundWorklogMinutes } from "@/server/worklogs/time";

import { fingerprintPayload } from "./fingerprint";
import type { EnqueueIntegrationOperation } from "./types";

type ScheduleTechnician = {
  eventId?: string;
  mspCentralTechnicianId?: string;
  technicianEmail?: string;
  technicianId: string;
  technicianName?: string;
  userPrincipalName: string;
};

type PreviousScheduleAssignment = {
  eventId: string;
  technicianId: string;
  userPrincipalName: string;
};

export type ScheduleOperationInput = {
  actorEmail: string;
  appointmentId: string;
  bookingType?: BookingType;
  crew?: ScheduleTechnician[];
  customer?: string;
  date: string;
  end: string;
  idempotencyKey: string;
  lead: ScheduleTechnician;
  location?: string;
  previousAssignments?: PreviousScheduleAssignment[];
  priority?: Priority;
  requestId: string;
  requestNumber: string;
  sourceVersion?: string;
  start: string;
  subject: string;
};

export type WorklogOperationInput = {
  actorEmail: string;
  calendarAssignments?: PreviousScheduleAssignment[];
  command: WorklogDispositionCommand;
  ownerId: string;
  sourceVersion?: string;
};

export type CommunicationOperationInput = {
  actorEmail: string;
  body: string;
  idempotencyKey: string;
  occurredAt: string;
  requestId: string;
  sourceVersion?: string;
  visibility: "customer" | "internal";
};

export type CreateRequestOperationInput = {
  actorEmail: string;
  customer?: string;
  description?: string;
  idempotencyKey: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  requesterEmail?: string;
  site?: string;
  sourceVersion?: string;
  subject: string;
};

export type MergeOperationInput = {
  actorEmail: string;
  childRequestId: string;
  idempotencyKey: string;
  parentRequestId: string;
  sourceVersion?: string;
};

export function scheduleOperation(
  input: ScheduleOperationInput,
): EnqueueIntegrationOperation {
  const crew = uniqueTechnicians(input.crew ?? []).sort(byTechnicianId);
  if (crew.some((member) => member.technicianId === input.lead.technicianId)) {
    throw new Error("The lead technician cannot also be selected as crew.");
  }

  const previousAssignments = [...(input.previousAssignments ?? [])].sort(
    byTechnicianId,
  );
  const selectedIds = new Set([
    input.lead.technicianId,
    ...crew.map((member) => member.technicianId),
  ]);
  const obsoleteAssignments = previousAssignments.filter(
    (assignment) => !selectedIds.has(assignment.technicianId),
  );
  const scheduledStart = withMelbourneOffset(input.date, input.start);
  const scheduledEnd = withMelbourneOffset(input.date, input.end);
  const graphStart = `${input.date}T${input.start}:00`;
  const graphEnd = `${input.date}T${input.end}:00`;
  const leadStepKey = `outlook:lead:${input.lead.technicianId}`;
  const crewStepKeys = crew.map(
    (member) => `outlook:crew:${member.technicianId}`,
  );
  const normalized = jsonRecord({
    appointmentId: input.appointmentId,
    bookingType: input.bookingType,
    crew,
    customer: clean(input.customer),
    date: input.date,
    end: input.end,
    lead: input.lead,
    location: clean(input.location),
    previousAssignments,
    priority: input.priority,
    requestId: input.requestId,
    requestNumber: input.requestNumber,
    scheduledEnd,
    scheduledStart,
    start: input.start,
    subject: input.subject,
  });
  const baseEvent = jsonRecord({
    appointmentId: input.appointmentId,
    bodyPreview: [
      `Command-Centre-Booking: ${input.appointmentId}`,
      `Request: ${input.requestNumber}`,
      clean(input.customer) ? `Company: ${clean(input.customer)}` : undefined,
      clean(input.location) ? `Site: ${clean(input.location)}` : undefined,
      input.bookingType ? `Booking Type: ${input.bookingType}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    end: graphEnd,
    location: clean(input.location),
    requestId: input.requestId,
    requestNumber: input.requestNumber,
    start: graphStart,
    subject: input.subject,
  });

  return operation({
    actionType: "dispatch.schedule",
    actorEmail: input.actorEmail,
    idempotencyKey: input.idempotencyKey,
    payload: normalized,
    requestId: input.requestId,
    sourceVersion: input.sourceVersion,
    steps: [
      step("msp_central", "msp.schedule_request", "msp:schedule", {
        requestId: input.requestId,
        scheduledEnd,
        scheduledStart,
        technicianEmail: clean(input.lead.technicianEmail),
        technicianId: clean(input.lead.mspCentralTechnicianId),
        technicianName: clean(input.lead.technicianName),
      }),
      outlookUpsertStep({
        event: baseEvent,
        idempotencyKey: input.idempotencyKey,
        role: "lead",
        technician: input.lead,
      }),
      ...crew.map((technician) =>
        outlookUpsertStep({
          event: baseEvent,
          idempotencyKey: input.idempotencyKey,
          role: "crew",
          technician,
        }),
      ),
      ...obsoleteAssignments.map((assignment) =>
        step(
          "outlook",
          "outlook.delete_event",
          `outlook:cleanup:${assignment.technicianId}`,
          assignment,
        ),
      ),
      step(
        "command_centre",
        "command_centre.persist_dispatch_link",
        "command:link",
        {
          ...normalized,
          outlookStepKeys: { crew: crewStepKeys, lead: leadStepKey },
        },
      ),
      refreshStep(input.requestId),
    ],
  });
}

export function worklogOperation(
  input: WorklogOperationInput,
): EnqueueIntegrationOperation {
  const command = {
    ...input.command,
    durationMinutes: roundWorklogMinutes(input.command.durationMinutes),
  };
  const assignments = uniqueAssignments([
    ...(input.calendarAssignments ?? []),
    ...(command.currentBooking?.eventId && command.currentBooking.userPrincipalName
      ? [
          {
            eventId: command.currentBooking.eventId,
            technicianId: command.currentBooking.technicianId ?? "current",
            userPrincipalName: command.currentBooking.userPrincipalName,
          },
        ]
      : []),
  ]).sort(byTechnicianId);
  const steps: EnqueueIntegrationOperation["steps"] = [
    step("msp_central", "msp.add_worklog", "msp:worklog", {
      contentFingerprint: fingerprintPayload(command.description.trim()),
      description: command.description,
      durationMinutes: command.durationMinutes,
      endedAt: command.endedAt,
      ownerId: input.ownerId,
      requestId: command.requestId,
      startedAt: command.startedAt,
      worklogType: command.workType,
    }),
  ];

  appendDispositionSteps(steps, command, assignments);
  steps.push(refreshStep(command.requestId));

  return operation({
    actionType: "helpdesk.worklog",
    actorEmail: input.actorEmail,
    idempotencyKey: command.idempotencyKey,
    payload: jsonRecord({ assignments, command, ownerId: input.ownerId }),
    requestId: command.requestId,
    sourceVersion: input.sourceVersion,
    steps,
  });
}

export function communicationOperation(
  input: CommunicationOperationInput,
): EnqueueIntegrationOperation {
  const visibility = input.visibility === "internal" ? "internal" : "customer";
  const payload = jsonRecord({
    contentFingerprint: fingerprintPayload(input.body.trim()),
    description: input.body.trim(),
    occurredAt: input.occurredAt,
    requestId: input.requestId,
    showToRequester: visibility === "customer",
    visibility,
  });

  return operation({
    actionType: "helpdesk.communication",
    actorEmail: input.actorEmail,
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.requestId,
    sourceVersion: input.sourceVersion,
    steps: [
      step("msp_central", "msp.add_note", "msp:communication", payload),
      refreshStep(input.requestId),
    ],
  });
}

export function createRequestOperation(
  input: CreateRequestOperationInput,
): EnqueueIntegrationOperation {
  const request = jsonRecord({
    customer: clean(input.customer),
    description: clean(input.description),
    priority: input.priority,
    requesterEmail: clean(input.requesterEmail)?.toLowerCase(),
    site: clean(input.site),
    subject: input.subject.trim(),
  });
  const commandFingerprint = fingerprintPayload(request);
  const pendingRequestId = `pending:${commandFingerprint.slice(0, 24)}`;
  return operation({
    actionType: "helpdesk.create_request",
    actorEmail: input.actorEmail,
    idempotencyKey: input.idempotencyKey,
    payload: { ...request, commandFingerprint },
    requestId: pendingRequestId,
    sourceVersion: input.sourceVersion,
    steps: [
      step(
        "msp_central",
        "msp.create_request",
        "msp:create-request",
        { ...request, commandFingerprint },
      ),
      step(
        "command_centre",
        "command_centre.invalidate_created_request",
        "command:refresh",
        {
          providerStepKey: "msp:create-request",
          requestId: pendingRequestId,
        },
      ),
    ],
  });
}

export function mergeOperation(
  input: MergeOperationInput,
): EnqueueIntegrationOperation {
  const payload = {
    childRequestId: input.childRequestId,
    parentRequestId: input.parentRequestId,
  };
  return operation({
    actionType: "helpdesk.merge",
    actorEmail: input.actorEmail,
    idempotencyKey: input.idempotencyKey,
    payload,
    requestId: input.childRequestId,
    sourceVersion: input.sourceVersion,
    steps: [
      step("msp_central", "msp.merge_requests", "msp:merge", payload),
      step(
        "command_centre",
        "command_centre.invalidate_request",
        "command:refresh",
        {
          relatedRequestIds: [input.childRequestId, input.parentRequestId],
          requestId: input.childRequestId,
        },
      ),
    ],
  });
}

function appendDispositionSteps(
  steps: EnqueueIntegrationOperation["steps"],
  command: WorklogDispositionCommand,
  assignments: PreviousScheduleAssignment[],
) {
  if (!command.disposition) return;

  if (command.disposition === "complete") {
    if (command.solution) {
      steps.push(
        step("msp_central", "msp.set_solution", "msp:solution", {
          content: command.solution,
          requestId: command.requestId,
        }),
        step("msp_central", "msp.add_note", "msp:solution-message", {
          contentFingerprint: fingerprintPayload(command.solution.trim()),
          description: command.solution,
          occurredAt: command.endedAt,
          requestId: command.requestId,
          showToRequester: true,
          visibility: "customer",
        }),
      );
    }
    steps.push(statusStep(command.requestId, "Resolved", "resolved"));
    appendCalendarCleanup(steps, assignments);
    steps.push(clearScheduleStep(command.requestId));
    return;
  }

  if (command.disposition === "return_to_queue") {
    steps.push(statusStep(command.requestId, "Open", "open"));
    appendCalendarCleanup(steps, assignments);
    steps.push(clearScheduleStep(command.requestId));
    return;
  }

  if (command.disposition === "transfer_escalate" && command.transfer) {
    steps.push(
      step("msp_central", "msp.assign_request", "msp:transfer", {
        requestId: command.requestId,
        technicianEmail: clean(command.transfer.targetEmail),
        technicianId: command.transfer.targetTechnicianId,
        technicianName: clean(command.transfer.targetTechnicianName),
      }),
      statusStep(command.requestId, "Open", "open"),
    );
    appendCalendarCleanup(steps, assignments);
    steps.push(
      step(
        "command_centre",
        "command_centre.persist_transfer",
        "command:transfer",
        {
          reason: command.transfer.reason,
          requestId: command.requestId,
          targetEmail: clean(command.transfer.targetEmail),
          targetTechnicianId: command.transfer.targetTechnicianId,
        },
      ),
    );
    return;
  }

  if (command.disposition === "book_forward" && command.booking) {
    const booking = command.booking;
    steps.push(
      step("msp_central", "msp.schedule_request", "msp:book-forward", {
        requestId: command.requestId,
        scheduledEnd: withMelbourneOffset(booking.date, booking.end),
        scheduledStart: withMelbourneOffset(booking.date, booking.start),
        technicianEmail: clean(booking.technicianEmail),
        technicianName: booking.technicianName,
      }),
      step("outlook", "outlook.upsert_event", "outlook:book-forward", {
        appointmentId: `book-forward:${command.requestId}`,
        bodyPreview: [
          `Command-Centre-Booking: book-forward:${command.requestId}`,
          `Request: ${booking.requestNumber}`,
        ].join("\n"),
        end: `${booking.date}T${booking.end}:00`,
        eventId: clean(booking.eventId),
        location: clean(booking.location),
        requestId: command.requestId,
        requestNumber: booking.requestNumber,
        start: `${booking.date}T${booking.start}:00`,
        subject: booking.subject,
        technicianId: booking.technicianId,
        transactionId: `${command.idempotencyKey}:outlook:${booking.technicianId}`,
        userPrincipalName: booking.userPrincipalName,
      }),
    );
    appendCalendarCleanup(
      steps,
      assignments.filter(
        (assignment) =>
          assignment.eventId !== booking.eventId ||
          assignment.userPrincipalName !== booking.userPrincipalName,
      ),
    );
    steps.push(
      step(
        "command_centre",
        "command_centre.persist_book_forward",
        "command:book-forward",
        jsonRecord({
          booking,
          requestId: command.requestId,
          scheduledEnd: withMelbourneOffset(booking.date, booking.end),
          scheduledStart: withMelbourneOffset(booking.date, booking.start),
        }),
      ),
    );
  }
}

function appendCalendarCleanup(
  steps: EnqueueIntegrationOperation["steps"],
  assignments: PreviousScheduleAssignment[],
) {
  for (const assignment of assignments) {
    steps.push(
      step(
        "outlook",
        "outlook.delete_event",
        `outlook:cleanup:${assignment.technicianId}:${fingerprintPayload(
          assignment.eventId,
        ).slice(0, 12)}`,
        assignment,
      ),
    );
  }
}

function outlookUpsertStep({
  event,
  idempotencyKey,
  role,
  technician,
}: {
  event: Record<string, unknown>;
  idempotencyKey: string;
  role: "crew" | "lead";
  technician: ScheduleTechnician;
}) {
  return step(
    "outlook",
    "outlook.upsert_event",
    `outlook:${role}:${technician.technicianId}`,
    {
      ...event,
      eventId: clean(technician.eventId),
      role,
      technicianEmail: clean(technician.technicianEmail),
      technicianId: technician.technicianId,
      technicianName: clean(technician.technicianName),
      transactionId: `${idempotencyKey}:outlook:${technician.technicianId}`,
      userPrincipalName: technician.userPrincipalName,
    },
  );
}

function statusStep(requestId: string, status: string, key: string) {
  return step("msp_central", "msp.update_status", `msp:status:${key}`, {
    requestId,
    status,
  });
}

function clearScheduleStep(requestId: string) {
  return step(
    "command_centre",
    "command_centre.clear_schedule",
    "command:clear-schedule",
    { requestId },
  );
}

function refreshStep(requestId: string) {
  return step(
    "command_centre",
    "command_centre.invalidate_request",
    "command:refresh",
    { requestId },
  );
}

function operation(input: EnqueueIntegrationOperation) {
  return {
    ...input,
    actorEmail: input.actorEmail.trim().toLowerCase(),
    ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}),
  };
}

function step(
  connector: EnqueueIntegrationOperation["steps"][number]["connector"],
  action: string,
  stepKey: string,
  payload: object,
) {
  return { action, connector, payload: jsonRecord(payload), stepKey };
}

function jsonRecord(value: object): Record<string, unknown> {
  return removeUndefined(value) as Record<string, unknown>;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, removeUndefined(entry)]),
    );
  }
  return value;
}

function uniqueTechnicians(technicians: ScheduleTechnician[]) {
  const unique = new Map<string, ScheduleTechnician>();
  for (const technician of technicians) {
    if (unique.has(technician.technicianId)) {
      throw new Error("A technician can only be selected once.");
    }
    unique.set(technician.technicianId, technician);
  }
  return [...unique.values()];
}

function uniqueAssignments(assignments: PreviousScheduleAssignment[]) {
  return [
    ...new Map(
      assignments.map((assignment) => [
        `${assignment.userPrincipalName}:${assignment.eventId}`,
        assignment,
      ]),
    ).values(),
  ];
}

function byTechnicianId(
  left: { technicianId: string },
  right: { technicianId: string },
) {
  return left.technicianId < right.technicianId
    ? -1
    : left.technicianId > right.technicianId
      ? 1
      : 0;
}

function withMelbourneOffset(date: string, time: string) {
  const month = Number(date.slice(5, 7));
  const offset = month >= 4 && month <= 9 ? "+10:00" : "+11:00";
  return `${date}T${time}:00${offset}`;
}

function clean(value?: string) {
  return value?.trim() || undefined;
}
