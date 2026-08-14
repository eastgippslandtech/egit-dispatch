import type { Appointment, DispatchRequest } from "./types";

const LINK_TOKEN_PATTERN = /\b\d{5,}\b/g;

export type CancelledOutlookEventCleanup = {
  eventId: string;
  requestId: string;
  requestNumber: string;
  technicianId?: string;
  userPrincipalName: string;
};

export type OrphanedOutlookEventCleanup = {
  eventId: string;
  requestNumber: string;
  technicianId?: string;
  userPrincipalName: string;
};

export function mergeMspCentralScheduleWithOutlook(
  requests: DispatchRequest[],
  outlookAppointments: Appointment[],
  options: { pruneOrphanedOutlookEvents?: boolean } = {},
) {
  const requestTokens = requests.map((request) => ({
    request,
    tokens: requestLinkTokens(request),
  }));
  const consumedOutlookAppointmentIds = new Set<string>();
  const cancelledOutlookEvents: CancelledOutlookEventCleanup[] = [];
  const orphanedOutlookEvents: OrphanedOutlookEventCleanup[] = [];
  const appointments: Appointment[] = [];

  for (const request of requests) {
    if (isCancelledRequest(request)) {
      const staleOutlookAppointments = findMatchingOutlookAppointments(
        outlookAppointments,
        requestLinkTokens(request),
        consumedOutlookAppointmentIds,
      );
      for (const staleOutlookAppointment of staleOutlookAppointments) {
        consumedOutlookAppointmentIds.add(staleOutlookAppointment.id);
        const cleanup = cancelledOutlookCleanup(request, staleOutlookAppointment);
        if (cleanup) cancelledOutlookEvents.push(cleanup);
      }
      continue;
    }

    const mspAppointment = mspAppointmentFromRequest(request);
    const linkedOutlook = linkMatchingOutlookAppointmentsForRequest(
      request,
      outlookAppointments,
      requestLinkTokens(request),
      consumedOutlookAppointmentIds,
      mspAppointment,
    );
    appointments.push(...linkedOutlook.appointments);
    orphanedOutlookEvents.push(...linkedOutlook.orphanedOutlookEvents);

    const hasPrimaryCalendarBooking =
      mspAppointment &&
      linkedOutlook.appointments.some(
        (appointment) => appointment.technicianId === request.technicianId,
      );

    if (mspAppointment && !hasPrimaryCalendarBooking) {
      appointments.push(mspAppointment);
    }
  }

  for (const outlookAppointment of outlookAppointments) {
    if (consumedOutlookAppointmentIds.has(outlookAppointment.id)) continue;

    const request = requestTokens.find(({ tokens }) =>
      appointmentMatchesTokens(outlookAppointment, tokens),
    )?.request;
    if (request && isCancelledRequest(request)) continue;
    if (!request && options.pruneOrphanedOutlookEvents) {
      const cleanup = orphanedOutlookCleanup(outlookAppointment);
      if (cleanup) {
        orphanedOutlookEvents.push(cleanup);
        continue;
      }
    }

    appointments.push(
      request
        ? linkAppointmentToRequest(outlookAppointment, request)
        : outlookAppointment,
    );
  }

  return {
    appointments,
    cancelledOutlookEvents,
    orphanedOutlookEvents,
    requests: hydrateRequestsFromAppointments(requests, appointments),
  };
}

function mspAppointmentFromRequest(
  request: DispatchRequest,
): Appointment | undefined {
  if (isCancelledRequest(request)) return undefined;
  if (!request.scheduledStart || !request.technicianId) return undefined;

  const start = melbourneDateTime(request.scheduledStart);
  const end = melbourneDateTime(
    request.scheduledEnd ??
      new Date(new Date(request.scheduledStart).getTime() + 60 * 60_000).toISOString(),
  );
  if (!start || !end) return undefined;

  return {
    bookingType: request.bookingType,
    bodyPreview: request.notes,
    customer: request.customer,
    date: start.date,
    end: end.time,
    helpdeskUrl: request.helpdeskUrl,
    id: `msp-${request.id}`,
    outlookLinkedRequestNumber: primaryLinkToken(request),
    readOnly: false,
    requestId: request.id,
    siteAddress: request.siteAddress,
    siteArea: request.siteArea,
    siteTown: request.siteTown,
    source: "sdp",
    start: start.time,
    status: "sdp-only",
    syncIssue: "missing-calendar",
    technicianId: request.technicianId,
    title: request.subject,
  };
}

function linkAppointmentToRequest(
  outlookAppointment: Appointment,
  request: DispatchRequest,
  mspAppointment?: Appointment,
): Appointment {
  const timeMismatch = mspAppointment
    ? mspAppointment.date !== outlookAppointment.date ||
      mspAppointment.start !== outlookAppointment.start ||
      mspAppointment.end !== outlookAppointment.end ||
      mspAppointment.technicianId !== outlookAppointment.technicianId
    : false;

  return {
    ...outlookAppointment,
    bookingType: request.bookingType ?? outlookAppointment.bookingType,
    bodyPreview: outlookAppointment.bodyPreview ?? request.notes,
    customer:
      request.customer === "Unknown customer"
        ? outlookAppointment.customer
        : request.customer,
    helpdeskUrl: request.helpdeskUrl ?? outlookAppointment.helpdeskUrl,
    id: `linked-${request.id}-${outlookAppointment.technicianId}-${outlookAppointment.id}`,
    outlookLinkedRequestNumber:
      outlookAppointment.outlookLinkedRequestNumber ?? primaryLinkToken(request),
    readOnly: false,
    requestId: request.id,
    siteAddress: request.siteAddress ?? outlookAppointment.siteAddress,
    siteArea: request.siteArea ?? outlookAppointment.siteArea,
    siteTown: request.siteTown ?? outlookAppointment.siteTown,
    source: "linked",
    status: outlookAppointment.status === "tentative" ? "tentative" : "confirmed",
    syncIssue: timeMismatch ? "time-mismatch" : undefined,
    title: request.subject || outlookAppointment.title,
  };
}

function hydrateRequestsFromAppointments(
  requests: DispatchRequest[],
  appointments: Appointment[],
): DispatchRequest[] {
  const linkedAppointments = appointments
    .filter((appointment) => appointment.requestId)
    .sort((first, second) =>
      `${first.date ?? ""}T${first.start}`.localeCompare(
        `${second.date ?? ""}T${second.start}`,
      ),
    );

  return requests.map((request) => {
    if (isCancelledRequest(request)) {
      return {
        ...request,
        readyToBook: false,
        scheduledEnd: undefined,
        scheduledStart: undefined,
        technicianId: undefined,
      };
    }

    if (request.scheduledStart && request.scheduledEnd && request.technicianId) {
      return request;
    }

    const appointment = linkedAppointments.find(
      (candidate) => candidate.requestId === request.id,
    );
    if (!appointment?.date) return request;

    return {
      ...request,
      readyToBook: false,
      scheduledEnd:
        request.scheduledEnd ?? melbourneLocalTimestamp(appointment.date, appointment.end),
      scheduledStart:
        request.scheduledStart ??
        melbourneLocalTimestamp(appointment.date, appointment.start),
      status: request.status === "Resolved" ? request.status : ("Scheduled" as const),
      technicianId: request.technicianId ?? appointment.technicianId,
    };
  });
}

function isCancelledRequest(request: DispatchRequest) {
  return request.status === "Cancelled";
}

function cancelledOutlookCleanup(
  request: DispatchRequest,
  appointment: Appointment,
): CancelledOutlookEventCleanup | undefined {
  if (!appointment.outlookEventId || !appointment.calendarOwnerEmail) {
    return undefined;
  }

  return {
    eventId: appointment.outlookEventId,
    requestId: request.id,
    requestNumber: request.requestNumber,
    technicianId: appointment.technicianId,
    userPrincipalName: appointment.calendarOwnerEmail,
  };
}

function orphanedOutlookCleanup(
  appointment: Appointment,
): OrphanedOutlookEventCleanup | undefined {
  const requestNumber =
    appointment.outlookLinkedRequestNumber ??
    appointmentLinkTokens(appointment).values().next().value;
  if (!requestNumber || !appointment.outlookEventId || !appointment.calendarOwnerEmail) {
    return undefined;
  }

  return {
    eventId: appointment.outlookEventId,
    requestNumber,
    technicianId: appointment.technicianId,
    userPrincipalName: appointment.calendarOwnerEmail,
  };
}

function linkMatchingOutlookAppointmentsForRequest(
  request: DispatchRequest,
  outlookAppointments: Appointment[],
  tokens: ReadonlySet<string>,
  consumedAppointmentIds: Set<string>,
  mspAppointment?: Appointment,
) {
  const candidates = findMatchingOutlookAppointments(
    outlookAppointments,
    tokens,
    consumedAppointmentIds,
  );
  const appointments: Appointment[] = [];
  const orphanedOutlookEvents: OrphanedOutlookEventCleanup[] = [];

  for (const group of groupAppointmentsByTechnician(candidates).values()) {
    const canonical = selectCanonicalOutlookAppointment(
      group,
      request,
      mspAppointment,
    );
    if (!canonical) continue;

    for (const appointment of group) {
      consumedAppointmentIds.add(appointment.id);
    }

    appointments.push(
      linkAppointmentToRequest(
        canonical,
        request,
        canonical.technicianId === request.technicianId ? mspAppointment : undefined,
      ),
    );

    for (const staleAppointment of group) {
      if (staleAppointment.id === canonical.id) continue;
      const cleanup = orphanedOutlookCleanup(staleAppointment);
      if (cleanup) orphanedOutlookEvents.push(cleanup);
    }
  }

  return {
    appointments,
    orphanedOutlookEvents,
  };
}

function groupAppointmentsByTechnician(appointments: Appointment[]) {
  const groups = new Map<string, Appointment[]>();

  for (const appointment of appointments) {
    const key =
      appointment.technicianId ??
      appointment.calendarOwnerEmail ??
      `unknown-${appointment.id}`;
    const group = groups.get(key);
    if (group) {
      group.push(appointment);
    } else {
      groups.set(key, [appointment]);
    }
  }

  return groups;
}

function selectCanonicalOutlookAppointment(
  candidates: Appointment[],
  request: DispatchRequest,
  mspAppointment?: Appointment,
) {
  if (candidates.length === 0) return undefined;

  if (mspAppointment) {
    const exactMspMatch = candidates.find((appointment) =>
      appointmentsShareSchedule(appointment, mspAppointment),
    );
    if (exactMspMatch) return exactMspMatch;
  }

  return (
    [...candidates]
      .sort((first, second) => {
        const firstIsRequestTech = first.technicianId === request.technicianId;
        const secondIsRequestTech = second.technicianId === request.technicianId;
        if (firstIsRequestTech !== secondIsRequestTech) {
          return firstIsRequestTech ? -1 : 1;
        }

        return scheduleSortKey(second).localeCompare(scheduleSortKey(first));
      })
      .at(0) ?? candidates[0]
  );
}

function appointmentsShareSchedule(
  appointment: Appointment,
  target: Appointment,
) {
  return (
    appointment.date === target.date &&
    appointment.start === target.start &&
    appointment.end === target.end &&
    appointment.technicianId === target.technicianId
  );
}

function scheduleSortKey(appointment: Appointment) {
  return `${appointment.date ?? ""}T${appointment.start}-${appointment.end}`;
}

function findMatchingOutlookAppointments(
  outlookAppointments: Appointment[],
  tokens: ReadonlySet<string>,
  consumedAppointmentIds: ReadonlySet<string>,
) {
  return outlookAppointments.filter(
    (appointment) =>
      !consumedAppointmentIds.has(appointment.id) &&
      appointmentMatchesTokens(appointment, tokens),
  );
}

function appointmentMatchesTokens(
  appointment: Appointment,
  tokens: ReadonlySet<string>,
) {
  return [...appointmentLinkTokens(appointment)].some((token) => tokens.has(token));
}

function requestLinkTokens(request: DispatchRequest) {
  return linkTokens([
    request.id,
    request.requestNumber,
    request.subject,
    request.notes,
    request.helpdeskUrl,
  ]);
}

function appointmentLinkTokens(appointment: Appointment) {
  return linkTokens([
    appointment.requestId,
    appointment.outlookLinkedRequestNumber,
    appointment.title,
    appointment.bodyPreview,
    appointment.helpdeskUrl,
  ]);
}

function linkTokens(values: Array<string | undefined>) {
  const tokens = new Set<string>();

  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(LINK_TOKEN_PATTERN)) {
      tokens.add(match[0]);
    }
  }

  return tokens;
}

function primaryLinkToken(request: DispatchRequest) {
  return [...requestLinkTokens(request)][0] ?? request.requestNumber;
}

function melbourneDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: "Australia/Melbourne",
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function melbourneLocalTimestamp(dateKey: string, time: string) {
  return `${dateKey}T${time.slice(0, 5)}:00${melbourneOffset(dateKey, time)}`;
}

function melbourneOffset(dateKey: string, time: string) {
  const guess = new Date(`${dateKey}T${time.slice(0, 5)}:00Z`);
  const offsetName =
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne",
      timeZoneName: "longOffset",
    })
      .formatToParts(guess)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+10:00";

  return offsetName.replace("GMT", "");
}
