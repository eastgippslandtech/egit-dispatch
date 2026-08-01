import type { BookingType } from "@/server/dispatch/types";
import { roundWorklogMinutes } from "./time";

export const worklogDispositions = [
  "complete",
  "return_to_queue",
  "book_forward",
  "transfer_escalate",
] as const;

export type WorklogDisposition = (typeof worklogDispositions)[number];

export type WorklogType = "billable" | "non_billable" | "internal";
export type WorklogVisibility = "external" | "internal";

export type WorklogForwardBooking = {
  bookingType: BookingType;
  customer?: string;
  date: string;
  end: string;
  eventId?: string;
  location?: string;
  requestNumber: string;
  start: string;
  subject: string;
  technicianEmail?: string;
  technicianId: string;
  technicianName: string;
  userPrincipalName: string;
};

export type WorklogTransfer = {
  reason: string;
  targetEmail?: string;
  targetTechnicianId: string;
  targetTechnicianName?: string;
};

export type WorklogCurrentBooking = {
  eventId?: string;
  technicianId?: string;
  userPrincipalName?: string;
};

export type WorklogDispositionCommand = {
  booking?: WorklogForwardBooking;
  currentBooking?: WorklogCurrentBooking;
  description: string;
  disposition?: WorklogDisposition;
  durationMinutes: number;
  endedAt: string;
  idempotencyKey: string;
  requestId: string;
  scheduled: boolean;
  startedAt: string;
  transfer?: WorklogTransfer;
  visibility: WorklogVisibility;
  workType: WorklogType;
};

export function validateWorklogDispositionCommand(
  input: Partial<WorklogDispositionCommand>,
): WorklogDispositionCommand {
  const command: WorklogDispositionCommand = {
    booking: input.booking,
    currentBooking: input.currentBooking,
    description: clean(input.description),
    disposition: validDisposition(input.disposition),
    durationMinutes: roundWorklogMinutes(Number(input.durationMinutes)),
    endedAt: clean(input.endedAt),
    idempotencyKey: clean(input.idempotencyKey),
    requestId: clean(input.requestId),
    scheduled: input.scheduled === true,
    startedAt: clean(input.startedAt),
    transfer: input.transfer,
    visibility: validVisibility(input.visibility),
    workType: validWorklogType(input.workType),
  };

  if (
    !command.description ||
    !command.requestId ||
    !command.idempotencyKey ||
    !command.startedAt ||
    !command.endedAt ||
    !Number.isFinite(command.durationMinutes) ||
    command.durationMinutes <= 0
  ) {
    throw new Error(
      "A request, note, positive Work Log duration, and idempotency key are required.",
    );
  }
  if (
    !Number.isFinite(new Date(command.startedAt).getTime()) ||
    !Number.isFinite(new Date(command.endedAt).getTime())
  ) {
    throw new Error("Work Log start and end times are invalid.");
  }
  if (command.scheduled && !command.disposition) {
    throw new Error("Choose what happens to this scheduled job after saving.");
  }
  if (command.workType === "billable" && command.visibility !== "external") {
    throw new Error("Billable Work Logs must be customer-facing.");
  }
  if (command.workType === "internal" && command.visibility !== "internal") {
    throw new Error("Internal Work Logs must use internal visibility.");
  }
  if (command.disposition === "book_forward") {
    command.booking = validateForwardBooking(command.booking);
  }
  if (command.disposition === "transfer_escalate") {
    const targetTechnicianId = clean(command.transfer?.targetTechnicianId);
    const reason = clean(command.transfer?.reason);
    if (!targetTechnicianId || !reason) {
      throw new Error("Transfer / escalate requires a target and reason.");
    }
    command.transfer = {
      reason,
      targetEmail: cleanOptional(command.transfer?.targetEmail),
      targetTechnicianId,
      targetTechnicianName: cleanOptional(
        command.transfer?.targetTechnicianName,
      ),
    };
  }

  return command;
}

function validateForwardBooking(
  booking?: WorklogForwardBooking,
): WorklogForwardBooking {
  if (
    !booking ||
    !clean(booking.date) ||
    !clean(booking.start) ||
    !clean(booking.end) ||
    !clean(booking.requestNumber) ||
    !clean(booking.subject) ||
    !clean(booking.technicianId) ||
    !clean(booking.technicianName) ||
    !clean(booking.userPrincipalName)
  ) {
    throw new Error(
      "Book Forward requires a technician, date, start time, end time, booking type, and request details.",
    );
  }
  if (minutesFromTime(booking.end) <= minutesFromTime(booking.start)) {
    throw new Error("Book Forward end time must be after the start time.");
  }
  if (!isBookingType(booking.bookingType)) {
    throw new Error("Book Forward booking type is invalid.");
  }

  return {
    ...booking,
    customer: cleanOptional(booking.customer),
    date: clean(booking.date),
    end: clean(booking.end),
    eventId: cleanOptional(booking.eventId),
    location: cleanOptional(booking.location),
    requestNumber: clean(booking.requestNumber),
    start: clean(booking.start),
    subject: clean(booking.subject),
    technicianEmail: cleanOptional(booking.technicianEmail),
    technicianId: clean(booking.technicianId),
    technicianName: clean(booking.technicianName),
    userPrincipalName: clean(booking.userPrincipalName),
  };
}

function validDisposition(value?: WorklogDisposition) {
  return worklogDispositions.includes(value as WorklogDisposition)
    ? value
    : undefined;
}

function validVisibility(value?: WorklogVisibility): WorklogVisibility {
  return value === "internal" ? "internal" : "external";
}

function validWorklogType(value?: WorklogType): WorklogType {
  if (value === "internal" || value === "non_billable") {
    return value;
  }
  return "billable";
}

function isBookingType(value?: BookingType): value is BookingType {
  return value === "Remote" || value === "Onsite" || value === "In house";
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function clean(value?: string) {
  return value?.trim() ?? "";
}

function cleanOptional(value?: string) {
  return clean(value) || undefined;
}
