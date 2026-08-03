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
  const previousAssignments = [...(input.previousAssignments ?? [])].sort(
    byTechnicianId,
  );
  const previousAssignmentByTechnician = new Map(
    previousAssignments.map((assignment) => [assignment.technicianId, assignment]),
  );
  const lead = inheritPreviousEventId(
    input.lead,
    previousAssignmentByTechnician,
  );
  const crew = uniqueTechnicians(input.crew ?? [])
    .sort(byTechnicianId)
    .map((technician) =>
      inheritPreviousEventId(technician, previousAssignmentByTechnician),
    );
  if (crew.some((member) => member.technicianId === input.lead.technicianId)) {
    throw new Error("The lead technician cannot also be selected as crew.");
  }

  const selectedIds = new Set([
    lead.technicianId,
    ...crew.map((member) => member.technicianId),
  ]);
  const obsoleteAssignments = previousAssignments.filter(
    (assignment) => !selectedIds.has(assignment.technicianId),
  );
  const scheduleWindow = roundScheduleWindow(input.date, input.start, input.end);
  const scheduledStart = withMelbourneOffset(
    scheduleWindow.startDate,
    scheduleWindow.start,
  );
  const scheduledEnd = withMelbourneOffset(
    scheduleWindow.endDate,
    scheduleWindow.end,
  );
  const graphStart = `${scheduleWindow.startDate}T${scheduleWindow.start}:00`;
  const graphEnd = `${scheduleWindow.endDate}T${scheduleWindow.end}:00`;
  const leadStepKey = `outlook:lead:${lead.technicianId}`;
  const crewStepKeys = crew.map(
    (member) => `outlook:crew:${member.technicianId}`,
  );
  const normalized = jsonRecord({
    appointmentId: input.appointmentId,
    bookingType: input.bookingType,
    crew,
    customer: clean(input.customer),
    date: scheduleWindow.startDate,
    end: scheduleWindow.end,
    endDate: scheduleWindow.endDate,
    lead,
    location: clean(input.location),
    previousAssignments,
    priority: input.priority,
    requestId: input.requestId,
    requestNumber: input.requestNumber,
    scheduledEnd,
    scheduledStart,
    start: scheduleWindow.start,
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
        technicianEmail: clean(lead.technicianEmail),
        technicianId: clean(lead.mspCentralTechnicianId),
        technicianName: clean(lead.technicianName),
      }),
      outlookUpsertStep({
        event: baseEvent,
        idempotencyKey: input.idempotencyKey,
        role: "lead",
        technician: lead,
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
    const scheduleWindow = roundScheduleWindow(
      booking.date,
      booking.start,
      booking.end,
    );
    const roundedBooking = {
      ...booking,
      date: scheduleWindow.startDate,
      end: scheduleWindow.end,
      endDate: scheduleWindow.endDate,
      start: scheduleWindow.start,
    };
    const scheduledStart = withMelbourneOffset(
      scheduleWindow.startDate,
      scheduleWindow.start,
    );
    const scheduledEnd = withMelbourneOffset(
      scheduleWindow.endDate,
      scheduleWindow.end,
    );
    steps.push(
      step("msp_central", "msp.schedule_request", "msp:book-forward", {
        requestId: command.requestId,
        scheduledEnd,
        scheduledStart,
        technicianEmail: clean(booking.technicianEmail),
        technicianName: booking.technicianName,
      }),
      step("outlook", "outlook.upsert_event", "outlook:book-forward", {
        appointmentId: `book-forward:${command.requestId}`,
        bodyPreview: [
          `Command-Centre-Booking: book-forward:${command.requestId}`,
          `Request: ${booking.requestNumber}`,
        ].join("\n"),
        end: `${scheduleWindow.endDate}T${scheduleWindow.end}:00`,
        eventId: clean(booking.eventId),
        location: clean(booking.location),
        requestId: command.requestId,
        requestNumber: booking.requestNumber,
        start: `${scheduleWindow.startDate}T${scheduleWindow.start}:00`,
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
          booking: roundedBooking,
          requestId: command.requestId,
          scheduledEnd,
          scheduledStart,
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

function inheritPreviousEventId(
  technician: ScheduleTechnician,
  previousAssignments: Map<string, PreviousScheduleAssignment>,
) {
  if (clean(technician.eventId)) return technician;
  const previous = previousAssignments.get(technician.technicianId);
  return previous?.eventId
    ? { ...technician, eventId: previous.eventId }
    : technician;
}

function roundScheduleWindow(date: string, start: string, end: string) {
  const startMinutes = localDateTimeMinutes(date, start);
  let endMinutes = localDateTimeMinutes(date, end);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;

  const roundedStart = roundUpToQuarterHour(startMinutes);
  let roundedEnd = roundUpToQuarterHour(endMinutes);
  if (roundedEnd <= roundedStart) roundedEnd = roundedStart + 15;

  const startParts = localDateTimeParts(roundedStart);
  const endParts = localDateTimeParts(roundedEnd);
  return {
    end: endParts.time,
    endDate: endParts.date,
    start: startParts.time,
    startDate: startParts.date,
  };
}

function localDateTimeMinutes(date: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new Error("Schedule date and time must use YYYY-MM-DD and HH:mm.");
  }
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const values = [year, month, day, hour, minute].map(Number);
  const [yearValue, monthValue, dayValue, hourValue, minuteValue] = values;
  if (
    hourValue > 23 ||
    minuteValue > 59 ||
    monthValue < 1 ||
    monthValue > 12 ||
    dayValue < 1 ||
    dayValue > 31
  ) {
    throw new Error("Schedule date or time is invalid.");
  }
  const timestamp = Date.UTC(
    yearValue,
    monthValue - 1,
    dayValue,
    hourValue,
    minuteValue,
  );
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== yearValue ||
    parsed.getUTCMonth() !== monthValue - 1 ||
    parsed.getUTCDate() !== dayValue
  ) {
    throw new Error("Schedule date or time is invalid.");
  }
  return timestamp / 60_000;
}

function roundUpToQuarterHour(minutes: number) {
  return Math.ceil(minutes / 15) * 15;
}

function localDateTimeParts(minutes: number) {
  const value = new Date(minutes * 60_000);
  return {
    date: [
      value.getUTCFullYear(),
      String(value.getUTCMonth() + 1).padStart(2, "0"),
      String(value.getUTCDate()).padStart(2, "0"),
    ].join("-"),
    time: [
      String(value.getUTCHours()).padStart(2, "0"),
      String(value.getUTCMinutes()).padStart(2, "0"),
    ].join(":"),
  };
}

function withMelbourneOffset(date: string, time: string) {
  const localMinutes = localDateTimeMinutes(date, time);
  const localMilliseconds = localMinutes * 60_000;
  let offsetMilliseconds = melbourneOffsetMilliseconds(
    new Date(localMilliseconds),
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    offsetMilliseconds = melbourneOffsetMilliseconds(
      new Date(localMilliseconds - offsetMilliseconds),
    );
  }
  const offsetMinutes = Math.round(offsetMilliseconds / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absoluteMinutes / 60)).padStart(
    2,
    "0",
  )}:${String(absoluteMinutes % 60).padStart(2, "0")}`;
  return `${date}T${time}:00${offset}`;
}

function melbourneOffsetMilliseconds(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Australia/Melbourne",
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return (
    Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    ) - instant.getTime()
  );
}

function clean(value?: string) {
  return value?.trim() || undefined;
}
