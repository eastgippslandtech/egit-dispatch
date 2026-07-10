import type { Appointment, Technician } from "@/server/dispatch/types";
import type { MicrosoftGraphEvent } from "./types";

const REQUEST_NUMBER_PATTERN =
  /\b(?:REQ|SDP|TICKET|REQUEST)?[- #:]*(\d{6})\b/i;

export function extractLinkedRequestNumber(
  subject?: string,
  bodyPreview?: string,
) {
  return (
    subject?.match(REQUEST_NUMBER_PATTERN)?.[1] ??
    bodyPreview?.match(REQUEST_NUMBER_PATTERN)?.[1]
  );
}

export function mapGraphEventToAppointment(
  event: MicrosoftGraphEvent,
  technician: Technician,
): Appointment {
  const isPrivate = event.sensitivity === "private" || !event.subject;
  const requestNumber = isPrivate
    ? undefined
    : extractLinkedRequestNumber(event.subject, event.bodyPreview);
  const isAllDay = Boolean(event.isAllDay);
  const serviceLooking = looksLikeServiceBooking(
    `${event.subject ?? ""} ${event.bodyPreview ?? ""}`,
  );
  const date = graphDateKey(event.start.dateTime);
  const start = isAllDay ? "09:00" : graphTime(event.start.dateTime);
  const end = isAllDay ? "17:30" : graphTime(event.end.dateTime);
  const subject = isPrivate ? "Private appointment" : event.subject?.trim();
  const location = event.location?.displayName?.trim();

  return {
    bodyPreview: isPrivate ? undefined : event.bodyPreview,
    calendarOwnerEmail: technician.outlookEmail,
    customer: isPrivate ? "Private" : location || "Outlook calendar",
    date,
    end,
    id: `outlook-${technician.id}-${event.id}`,
    isAllDay,
    outlookAttendees: event.attendees
      ?.map((attendee) => attendee.emailAddress?.address)
      .filter(Boolean) as string[] | undefined,
    outlookEventId: event.id,
    outlookIssue: outlookIssue({
      isAllDay,
      isPrivate,
      requestNumber,
      serviceLooking,
    }),
    outlookLinkedRequestNumber: requestNumber,
    outlookOrganizer: event.organizer?.emailAddress?.address,
    outlookShowAs: event.showAs,
    outlookWebLink: event.webLink,
    readOnly: true,
    requestId: requestNumber,
    source: "outlook",
    start,
    status: event.showAs === "tentative" ? "tentative" : "busy",
    technicianId: technician.id,
    title: subject || "Outlook appointment",
  };
}

function outlookIssue({
  isAllDay,
  isPrivate,
  requestNumber,
  serviceLooking,
}: {
  isAllDay: boolean;
  isPrivate: boolean;
  requestNumber?: string;
  serviceLooking: boolean;
}): Appointment["outlookIssue"] {
  if (isPrivate) {
    return "private";
  }

  if (isAllDay) {
    return "all-day";
  }

  if (!requestNumber && serviceLooking) {
    return "unlinked";
  }

  return undefined;
}

function graphDateKey(dateTime: string) {
  return dateTime.slice(0, 10);
}

function graphTime(dateTime: string) {
  return dateTime.match(/T(\d{2}:\d{2})/)?.[1] ?? "09:00";
}

function looksLikeServiceBooking(value: string) {
  return /(install|onsite|service|repair|ticket|request|firewall|server|workstation|printer|network|wifi|wi-fi|switch|router)/i.test(
    value,
  );
}
