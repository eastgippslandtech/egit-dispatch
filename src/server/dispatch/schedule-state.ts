import { todayDateKey } from "./date-scope";
import { melbourneDateTime, melbourneLocalTimestamp, requestBookingTechnicianId } from "./live-schedule";
import type { Appointment, DispatchDashboardData, DispatchRequest, Technician } from "./types";
import { appointmentRequestReference, requestIdentityKeys } from "./request-identity";

type SavedDashboard = Pick<DispatchDashboardData, "appointments" | "technicians">;
const REBOOKING_WARNING = "Past scheduled open job — needs rebooking.";
const isOpen = (request: DispatchRequest) => request.status !== "Resolved" && request.status !== "Cancelled";

/** Saved links retain booking intent outside the rolling Graph calendar window.
 * A returned Outlook event is authoritative for its current time. Missing events
 * remain explicitly unconfirmed; these placeholders must never enter cleanup.
 */
export function restoreSavedDispatchSchedules(
  requests: DispatchRequest[],
  calendar: Appointment[],
  saved: SavedDashboard | undefined,
  technicians: Technician[],
) {
  const fallbackAppointments: Appointment[] = [];
  const linkedCalendar = [...calendar];
  const leadBookings = new Map<string, Appointment>();
  const originalLeadBookings = new Map<string, Appointment>();
  const conflictingRequestIds = new Set<string>();
  for (const booking of saved?.appointments ?? []) {
    const request = requests.find((candidate) => candidate.id === booking.requestId && isOpen(candidate));
    if (!request || !booking.date) continue;
    const savedTechnician = saved?.technicians.find((candidate) => candidate.id === booking.technicianId);
    const principal = booking.calendarOwnerEmail ?? savedTechnician?.outlookEmail;
    const technician = technicians.find((candidate) =>
      principal && [candidate.outlookEmail, candidate.outlookUserPrincipalName].some(
        (email) => email?.toLowerCase() === principal.toLowerCase(),
      ),
    );
    // Database UUIDs and UI technician IDs are different namespaces.
    if (!technician) continue;
    const live = calendar.find((candidate) =>
      booking.outlookEventId && candidate.outlookEventId === booking.outlookEventId &&
      candidate.technicianId === technician.id && candidate.outlookIssue !== "private",
    );
    const liveReference = live && appointmentRequestReference(live);
    if (liveReference && !requestIdentityKeys(request).has(liveReference)) {
      // Positive evidence of another ticket is different from a missing calendar
      // read: never revive this stale link as a current/future placeholder.
      conflictingRequestIds.add(request.id);
      continue;
    }
    const appointment: Appointment = live ? {
      ...live, requestId: request.id, scheduleAssignmentRole: booking.scheduleAssignmentRole,
      scheduleGroupId: booking.scheduleGroupId,
    } : {
      ...booking, id: `saved-${booking.id}`, technicianId: technician.id,
      title: request.subject, customer: request.customer, source: "sdp", status: "sdp-only",
      syncIssue: "missing-calendar", outlookEventId: undefined, readOnly: false,
      siteAddress: request.siteAddress, siteTown: request.siteTown, siteArea: request.siteArea,
    };
    if (live) linkedCalendar[calendar.indexOf(live)] = appointment;
    if (!live) fallbackAppointments.push(appointment);
    if (booking.scheduleAssignmentRole !== "crew") {
      leadBookings.set(request.id, appointment);
      originalLeadBookings.set(request.id, booking);
    }
  }
  return {
    fallbackAppointments,
    calendar: linkedCalendar,
    requests: requests.map((request) => {
      if (conflictingRequestIds.has(request.id)) return {
        ...request,
        warnings: [...request.warnings, "Calendar link belongs to another ticket; review required."],
        readyToBook: request.scheduledStart ? request.readyToBook : true,
        needsRebooking: !request.scheduledStart,
      };
      const booking = leadBookings.get(request.id);
      const original = originalLeadBookings.get(request.id);
      const currentSchedule = request.scheduledStart ? melbourneDateTime(request.scheduledStart) : undefined;
      const currentEnd = request.scheduledEnd ? melbourneDateTime(request.scheduledEnd) : undefined;
      // Trust a moved event only when MSP still describes that saved slot.
      // An independently updated MSP future booking wins over old link history.
      const liveEventForCurrentSchedule = booking?.outlookEventId &&
        currentSchedule?.date === original?.date && currentSchedule?.time === original?.start &&
        (!currentEnd || currentEnd.time === original?.end);
      if (currentSchedule && currentSchedule.date >= todayDateKey() && !liveEventForCurrentSchedule) {
        return request;
      }
      return booking?.date && requestBookingTechnicianId(request, booking.technicianId) === booking.technicianId ? {
        ...request, technicianId: requestBookingTechnicianId(request, booking.technicianId),
        scheduledStart: melbourneLocalTimestamp(booking.date, booking.start),
        scheduledEnd: melbourneLocalTimestamp(booking.date, booking.end),
      } : request;
    }),
  };
}

export function includeSavedBookingPlaceholders(appointments: Appointment[], fallbacks: Appointment[]) {
  return [...appointments, ...fallbacks.filter((saved) => !appointments.some((appointment) =>
    appointment.requestId === saved.requestId && appointment.technicianId === saved.technicianId &&
    appointment.date === saved.date && appointment.start === saved.start && appointment.end === saved.end,
  ))];
}

/** Read-time projection only: never modifies Helpdesk, Outlook or saved links. */
export function applyBookingDayRollover(
  requests: DispatchRequest[], appointments: Appointment[], today = todayDateKey(),
) {
  const rebookingIds = new Set<string>();
  const projected = requests.map((request) => {
    if (!isOpen(request)) return { ...request, readyToBook: false, needsRebooking: false };
    const bookings = appointments.filter((appointment) => appointment.requestId === request.id && appointment.date);
    const upcoming = bookings.filter((appointment) => appointment.date! >= today)
      .sort((first, second) => `${first.date}T${first.start}`.localeCompare(`${second.date}T${second.start}`));
    const scheduled = request.scheduledStart ? melbourneDateTime(request.scheduledStart) : undefined;
    const exactBooking = upcoming.find((candidate) => candidate.date === scheduled?.date && candidate.start === scheduled?.time && candidate.technicianId === request.technicianId);
    const warnings = request.warnings.filter((warning) => warning !== REBOOKING_WARNING);
    if (!exactBooking && scheduled && scheduled.date >= today) {
      return { ...request, warnings, readyToBook: false, needsRebooking: false };
    }
    const booking = exactBooking ?? upcoming.find((candidate) => candidate.scheduleAssignmentRole !== "crew") ?? upcoming[0];
    if (booking?.date) return {
      ...request, warnings, readyToBook: false, needsRebooking: false,
      scheduledStart: melbourneLocalTimestamp(booking.date, booking.start),
      scheduledEnd: melbourneLocalTimestamp(booking.date, booking.end),
      technicianId: requestBookingTechnicianId(request, booking.technicianId),
    };
    if (scheduled && scheduled.date >= today) return { ...request, warnings, needsRebooking: false };
    if (scheduled || bookings.some((appointment) => appointment.date! < today)) {
      rebookingIds.add(request.id);
      return {
        ...request, warnings: [...warnings, REBOOKING_WARNING], readyToBook: true, needsRebooking: true,
        scheduledStart: undefined, scheduledEnd: undefined,
      };
    }
    return request;
  });
  return {
    requests: projected,
    appointments: appointments.map((appointment) => appointment.requestId && rebookingIds.has(appointment.requestId)
      ? { ...appointment, syncIssue: "past-open" as const } : appointment),
  };
}
