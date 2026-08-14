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
  description?: string;
  end: string;
  helpdeskUrl?: string;
  idempotencyKey: string;
  latestUpdate?: string;
  lead: ScheduleTechnician;
  location?: string;
  previousAssignments?: PreviousScheduleAssignment[];
  priority?: Priority;
  requestId: string;
  requestNumber: string;
  scheduleAction?: "scheduled" | "rescheduled";
  sourceVersion?: string;
  start: string;
  subject: string;
};

export type WorklogOperationInput = {
  actorEmail: string;
  calendarAssignments?: PreviousScheduleAssignment[];
  command: WorklogDispositionCommand;
  ownerEmail?: string;
  ownerId?: string;
  sourceVersion?: string;
  worklogAlreadySaved?: boolean;
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
  category?: string;
  customer?: string;
  customerId?: string;
  contactId?: string;
  description?: string;
  impact?: string;
  impactDetails?: string;
  idempotencyKey: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  requestType?: string;
  requesterEmail?: string;
  site?: string;
  sourceVersion?: string;
  status?: string;
  subcategory?: string;
  subject: string;
  technicianEmail?: string;
  technicianId?: string;
  technicianName?: string;
  urgency?: string;
};

export type MergeOperationInput = {
  actorEmail: string;
  childRequestId: string;
  idempotencyKey: string;
  parentRequestId: string;
  sourceVersion?: string;
};

export type CancelledScheduleCleanupOperationInput = {
  actorEmail: string;
  events: Array<{
    eventId: string;
    technicianId?: string;
    userPrincipalName: string;
  }>;
  idempotencyKey: string;
  requestId: string;
  requestNumber: string;
  sourceVersion?: string;
};

export type OrphanedOutlookCleanupOperationInput = {
  actorEmail: string;
  events: Array<{
    eventId: string;
    requestNumber: string;
    technicianId?: string;
    userPrincipalName: string;
  }>;
  idempotencyKey: string;
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
    description: clean(input.description),
    end: scheduleWindow.end,
    endDate: scheduleWindow.endDate,
    helpdeskUrl: clean(input.helpdeskUrl),
    latestUpdate: clean(input.latestUpdate),
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
      ...pushNotificationSteps({
        actorEmail: input.actorEmail,
        customer: input.customer,
        eventType:
          input.scheduleAction === "rescheduled"
            ? "schedule_changed"
            : "assignment",
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        requestNumber: input.requestNumber,
        subject: input.subject,
        technicians: [lead, ...crew],
        title:
          input.scheduleAction === "rescheduled"
            ? "Schedule changed"
            : "Ticket assigned",
      }),
      ...technicianScheduleEmailSteps({
        bookingType: input.bookingType,
        customer: input.customer,
        description: input.description,
        eventType:
          input.scheduleAction === "rescheduled" ? "rescheduled" : "assignment",
        helpdeskUrl: input.helpdeskUrl,
        idempotencyKey: input.idempotencyKey,
        latestUpdate: input.latestUpdate,
        requestId: input.requestId,
        requestNumber: input.requestNumber,
        scheduledDate: scheduleWindow.startDate,
        scheduledEnd: scheduleWindow.end,
        scheduledStart: scheduleWindow.start,
        site: input.location,
        subject: input.subject,
        technicians: [lead, ...crew],
      }),
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

export function cancelledScheduleCleanupOperation(
  input: CancelledScheduleCleanupOperationInput,
): EnqueueIntegrationOperation {
  const assignments = uniqueAssignments(
    input.events.map((event) => ({
      eventId: event.eventId,
      technicianId: event.technicianId ?? "unknown",
      userPrincipalName: event.userPrincipalName,
    })),
  ).sort(byTechnicianId);
  if (assignments.length === 0) {
    throw new Error("At least one linked Outlook event is required.");
  }
  const steps: EnqueueIntegrationOperation["steps"] = [];
  appendCalendarCleanup(steps, assignments);
  steps.push(clearScheduleStep(input.requestId), refreshStep(input.requestId));

  return operation({
    actionType: "dispatch.cancelled_schedule_cleanup",
    actorEmail: input.actorEmail,
    idempotencyKey: input.idempotencyKey,
    payload: jsonRecord({
      events: assignments,
      requestId: input.requestId,
      requestNumber: input.requestNumber,
    }),
    requestId: input.requestId,
    sourceVersion: input.sourceVersion,
    steps,
  });
}

export function orphanedOutlookCleanupOperation(
  input: OrphanedOutlookCleanupOperationInput,
): EnqueueIntegrationOperation {
  const assignments = uniqueAssignments(
    input.events.map((event) => ({
      eventId: event.eventId,
      technicianId: event.technicianId ?? "unknown",
      userPrincipalName: event.userPrincipalName,
    })),
  ).sort(byTechnicianId);
  if (assignments.length === 0) {
    throw new Error("At least one orphaned Outlook event is required.");
  }
  const requestNumbers = [
    ...new Set(input.events.map((event) => event.requestNumber).filter(Boolean)),
  ].sort();
  const requestId = `outlook-orphan:${requestNumbers[0] ?? "unknown"}`;
  const steps: EnqueueIntegrationOperation["steps"] = [];
  appendCalendarCleanup(steps, assignments);

  return operation({
    actionType: "dispatch.orphaned_outlook_cleanup",
    actorEmail: input.actorEmail,
    idempotencyKey: input.idempotencyKey,
    payload: jsonRecord({
      events: assignments,
      requestNumbers,
    }),
    requestId,
    sourceVersion: input.sourceVersion,
    steps,
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
  const steps: EnqueueIntegrationOperation["steps"] = input.worklogAlreadySaved
    ? []
    : [
        step("msp_central", "msp.add_worklog", "msp:worklog", {
          contentFingerprint: fingerprintPayload(command.description.trim()),
          description: command.description,
          durationMinutes: command.durationMinutes,
          endedAt: command.endedAt,
          ownerId: input.ownerId,
          ownerEmail: input.ownerEmail ?? input.actorEmail,
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
    payload: jsonRecord({
      assignments,
      command,
      ownerEmail: input.ownerEmail ?? input.actorEmail,
      ownerId: input.ownerId,
    }),
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
    actorEmail: input.actorEmail,
    contentFingerprint: fingerprintPayload(input.body.trim()),
    description: input.body.trim(),
    occurredAt: input.occurredAt,
    notifyTechnician: false,
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
      step(
        "msp_central",
        visibility === "customer" ? "msp.send_reply" : "msp.add_note",
        "msp:communication",
        payload,
      ),
      refreshStep(input.requestId),
    ],
  });
}

export function createRequestOperation(
  input: CreateRequestOperationInput,
): EnqueueIntegrationOperation {
  const request = jsonRecord({
    category: clean(input.category),
    customer: clean(input.customer),
    customerId: clean(input.customerId),
    contactId: clean(input.contactId),
    description: clean(input.description),
    impact: clean(input.impact),
    impactDetails: clean(input.impactDetails),
    priority: input.priority,
    requestType: clean(input.requestType),
    requesterEmail: clean(input.requesterEmail)?.toLowerCase(),
    site: clean(input.site),
    status: clean(input.status) ?? "Open",
    subcategory: clean(input.subcategory),
    subject: input.subject.trim(),
    technicianEmail: clean(input.technicianEmail)?.toLowerCase(),
    technicianId: clean(input.technicianId),
    technicianName: clean(input.technicianName),
    urgency: clean(input.urgency),
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

function technicianScheduleEmailSteps({
  bookingType,
  customer,
  description,
  eventType,
  helpdeskUrl,
  idempotencyKey,
  latestUpdate,
  requestId,
  requestNumber,
  scheduledDate,
  scheduledEnd,
  scheduledStart,
  site,
  subject,
  technicians,
}: {
  bookingType?: BookingType;
  customer?: string;
  description?: string;
  eventType: "assignment" | "rescheduled";
  helpdeskUrl?: string;
  idempotencyKey: string;
  latestUpdate?: string;
  requestId: string;
  requestNumber: string;
  scheduledDate: string;
  scheduledEnd: string;
  scheduledStart: string;
  site?: string;
  subject: string;
  technicians: ScheduleTechnician[];
}): EnqueueIntegrationOperation["steps"] {
  const unique = uniqueTechnicians(technicians);
  return unique
    .map((technician) => {
      const toEmail = clean(technician.technicianEmail) ?? clean(technician.userPrincipalName);
      if (!toEmail) return undefined;
      const payload = technicianScheduleEmailPayload({
        bookingType,
        customer,
        description,
        eventKey: `${idempotencyKey}:email:${eventType}:${technician.technicianId}`,
        helpdeskUrl,
        latestUpdate,
        requestId,
        requestNumber,
        scheduledDate,
        scheduledEnd,
        scheduledStart,
        site,
        subject,
        technicianName: technician.technicianName,
        toEmail,
      });
      return step(
        "email",
        "email.send_technician_schedule_confirmation",
        `email:${eventType}:${technician.technicianId}`,
        payload,
      );
    })
    .filter((emailStep): emailStep is EnqueueIntegrationOperation["steps"][number] =>
      Boolean(emailStep),
    );
}

function technicianScheduleEmailPayload(input: {
  bookingType?: BookingType;
  customer?: string;
  description?: string;
  eventKey: string;
  helpdeskUrl?: string;
  latestUpdate?: string;
  requestId: string;
  requestNumber: string;
  scheduledDate: string;
  scheduledEnd: string;
  scheduledStart: string;
  site?: string;
  subject: string;
  technicianName?: string;
  toEmail: string;
}) {
  const context = {
    ...input,
    bookingType: input.bookingType,
    customer: clean(input.customer),
    description: clean(input.description),
    helpdeskUrl:
      clean(input.helpdeskUrl) ??
      `https://command.egit.com.au/tickets/${encodeURIComponent(input.requestNumber)}`,
    latestUpdate: clean(input.latestUpdate),
    site: clean(input.site),
    technicianName: clean(input.technicianName),
  };
  return jsonRecord({
    ...context,
    html: buildTechnicianScheduleEmailHtml(context),
    plainText: buildTechnicianScheduleEmailText(context),
    subjectLine: `Scheduled: ${input.requestNumber} ${input.subject}`,
  });
}

function buildTechnicianScheduleEmailText(input: {
  bookingType?: BookingType;
  customer?: string;
  description?: string;
  helpdeskUrl: string;
  latestUpdate?: string;
  requestNumber: string;
  scheduledDate: string;
  scheduledEnd: string;
  scheduledStart: string;
  site?: string;
  subject: string;
  technicianName?: string;
}) {
  return [
    `Ticket scheduled: ${input.requestNumber}`,
    input.subject,
    "",
    input.technicianName ? `Technician: ${input.technicianName}` : undefined,
    input.customer ? `Customer: ${input.customer}` : undefined,
    input.site ? `Site: ${input.site}` : undefined,
    input.bookingType ? `Booking type: ${input.bookingType}` : undefined,
    `When: ${input.scheduledDate} ${input.scheduledStart}-${input.scheduledEnd}`,
    "",
    input.description ? `Description:\n${input.description}` : undefined,
    input.latestUpdate ? `Latest update:\n${input.latestUpdate}` : undefined,
    `Helpdesk: ${input.helpdeskUrl}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function buildTechnicianScheduleEmailHtml(input: {
  bookingType?: BookingType;
  customer?: string;
  description?: string;
  helpdeskUrl: string;
  latestUpdate?: string;
  requestNumber: string;
  scheduledDate: string;
  scheduledEnd: string;
  scheduledStart: string;
  site?: string;
  subject: string;
  technicianName?: string;
}) {
  const rows = [
    ["Technician", input.technicianName],
    ["Customer", input.customer],
    ["Site", input.site],
    ["Booking type", input.bookingType],
    ["When", `${input.scheduledDate} ${input.scheduledStart}-${input.scheduledEnd}`],
  ].filter(([, value]) => Boolean(value));

  return [
    "<div>",
    `<h2>Ticket scheduled: ${escapeHtml(input.requestNumber)}</h2>`,
    `<p><strong>${escapeHtml(input.subject)}</strong></p>`,
    "<table>",
    ...rows.map(
      ([label, value]) =>
        `<tr><td><strong>${escapeHtml(label ?? "")}</strong></td><td>${escapeHtml(value ?? "")}</td></tr>`,
    ),
    "</table>",
    input.description
      ? `<h3>Description</h3><p>${escapeHtml(input.description).replace(/\n/g, "<br />")}</p>`
      : undefined,
    input.latestUpdate
      ? `<h3>Latest update</h3><p>${escapeHtml(input.latestUpdate).replace(/\n/g, "<br />")}</p>`
      : undefined,
    `<p><a href="${escapeAttribute(input.helpdeskUrl)}">Open ticket in Helpdesk</a></p>`,
    "</div>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function pushNotificationSteps({
  actorEmail,
  customer,
  eventType,
  idempotencyKey,
  requestId,
  requestNumber,
  subject,
  technicians,
  title,
}: {
  actorEmail: string;
  customer?: string;
  eventType: "assignment" | "schedule_changed";
  idempotencyKey: string;
  requestId: string;
  requestNumber: string;
  subject: string;
  technicians: ScheduleTechnician[];
  title: string;
}): EnqueueIntegrationOperation["steps"] {
  const actor = normalizeEmail(actorEmail);
  return technicians
    .filter((technician) => !isActorTechnician(actor, technician))
    .map((technician) =>
      step("push", "push.notify", `push:${eventType}:${technician.technicianId}`, {
        body: `${requestNumber}: ${subject}`,
        customer: clean(customer),
        eventKey: `${idempotencyKey}:push:${eventType}:${technician.technicianId}`,
        eventType,
        requestId,
        requestNumber,
        technicianId: technician.technicianId,
        title,
      }),
    );
}

function isActorTechnician(actorEmail: string, technician: ScheduleTechnician) {
  return [technician.technicianEmail, technician.userPrincipalName].some(
    (email) => normalizeEmail(email) === actorEmail,
  );
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

function normalizeEmail(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}
