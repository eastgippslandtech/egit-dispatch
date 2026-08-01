import type {
  Appointment,
  BookingType,
  Technician,
} from "@/server/dispatch/types";
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
  const sensitivity = event.sensitivity?.toLowerCase();
  const isPersonal =
    ["confidential", "personal", "private"].includes(sensitivity ?? "") ||
    event.categories?.some(
      (category) => category.trim().toLowerCase() === "personal",
    ) === true;
  const isPrivate = isPersonal || !event.subject;
  const requestNumber = isPrivate
    ? undefined
    : extractLinkedRequestNumber(event.subject, event.bodyPreview);
  const location = event.location?.displayName?.trim();
  const locationBookingType = isPrivate
    ? undefined
    : bookingTypeFromLocation(location);
  const serviceDetails = parseServiceDetails(
    isPrivate ? undefined : event.bodyPreview,
  );
  const bookingType = isPrivate
    ? undefined
    : serviceDetails.bookingType ?? locationBookingType;
  const isAllDay = Boolean(event.isAllDay);
  const serviceLooking =
    Boolean(bookingType) ||
    looksLikeServiceBooking(
      `${event.subject ?? ""} ${event.bodyPreview ?? ""}`,
    );
  const date = graphDateKey(event.start.dateTime);
  const start = isAllDay ? "09:00" : graphTime(event.start.dateTime);
  const end = isAllDay ? "17:00" : graphTime(event.end.dateTime);
  const subject = isPrivate
    ? sensitivity === "personal" ||
      event.categories?.some(
        (category) => category.trim().toLowerCase() === "personal",
      )
      ? "Personal"
      : "Private appointment"
    : event.subject?.trim();

  return {
    bookingType,
    bodyPreview: isPrivate ? undefined : event.bodyPreview,
    calendarOwnerEmail: technician.outlookEmail,
    customer: isPrivate
      ? "Private"
      : serviceDetails.company ||
        (locationBookingType ? event.subject?.trim() : location) ||
        "Outlook calendar",
    date,
    end,
    id: `outlook-${technician.id}-${event.id}`,
    isAllDay,
    outlookAttendees: isPrivate
      ? undefined
      : (event.attendees
          ?.map((attendee) => attendee.emailAddress?.address)
          .filter(Boolean) as string[] | undefined),
    outlookCategories: event.categories,
    outlookEventId: event.id,
    outlookIssue: outlookIssue({
      isAllDay,
      isPrivate,
      requestNumber,
      serviceLooking,
    }),
    outlookLinkedRequestNumber: requestNumber,
    outlookOrganizer: event.organizer?.emailAddress?.address,
    outlookSensitivity: event.sensitivity,
    outlookShowAs: event.showAs,
    outlookWebLink: event.webLink,
    readOnly: true,
    requestId: requestNumber,
    siteAddress: serviceDetails.address,
    siteArea: serviceDetails.site,
    source: "outlook",
    start,
    status: event.showAs === "tentative" ? "tentative" : "busy",
    technicianId: technician.id,
    title: subject || "Outlook appointment",
  };
}

function bookingTypeFromLocation(location?: string): BookingType | undefined {
  const normalized = location
    ?.trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "on site" || normalized === "onsite") {
    return "Onsite";
  }

  if (normalized === "remote") {
    return "Remote";
  }

  if (normalized === "in house" || normalized === "inhouse") {
    return "In house";
  }

  return undefined;
}

function parseServiceDetails(bodyPreview?: string) {
  return {
    address: structuredField(bodyPreview, "Address"),
    bookingType: bookingTypeFromLocation(
      structuredField(bodyPreview, "Booking Type"),
    ),
    company: structuredField(bodyPreview, "Company"),
    site: structuredField(bodyPreview, "Site"),
  };
}

function structuredField(bodyPreview: string | undefined, label: string) {
  if (!bodyPreview) {
    return undefined;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return bodyPreview
    .match(new RegExp(`(?:^|\\r?\\n)\\s*${escapedLabel}\\s*:\\s*([^\\r\\n]+)`, "i"))
    ?.[1]
    ?.trim();
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
