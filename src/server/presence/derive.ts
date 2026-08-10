import type {
  Appointment,
  DispatchRequest,
  Technician,
} from "@/server/dispatch/types";
import { todayDateKey } from "@/server/dispatch/date-scope";

import type {
  PresenceLeave,
  PresenceOverride,
  PresenceStatus,
  TechnicianPresence,
} from "./types";

type PresenceCandidate = Omit<
  TechnicianPresence,
  "conflicts" | "remainingMinutes" | "technicianId"
>;

const STATUS_PRIORITY: Record<PresenceStatus, number> = {
  leave: 0,
  lunch: 1,
  driving: 2,
  on_site: 3,
  personal: 4,
  meeting: 5,
  in_office: 6,
  closed: 7,
};

const STATUS_LABEL: Record<PresenceStatus, string> = {
  closed: "Closed",
  leave: "Leave",
  lunch: "Lunch",
  driving: "Driving",
  on_site: "On site",
  personal: "Personal",
  meeting: "Meeting",
  in_office: "In office",
};

export function deriveTechnicianPresence({
  appointments,
  leaves,
  now,
  overrides,
  requests,
  technicians,
}: {
  appointments: Appointment[];
  leaves: PresenceLeave[];
  now: Date;
  overrides: PresenceOverride[];
  requests: DispatchRequest[];
  technicians: Technician[];
}): TechnicianPresence[] {
  return technicians
    .filter((technician) => technician.active)
    .map((technician) =>
      deriveOne({
        appointments: appointments.filter(
          (appointment) => appointment.technicianId === technician.id,
        ),
        leaves: leaves.filter((leave) =>
          sameEmail(leave.technicianEmail, technicianEmail(technician)),
        ),
        now,
        overrides: overrides.filter((override) =>
          sameEmail(override.technicianEmail, technicianEmail(technician)),
        ),
        requests,
        technician,
      }),
    );
}

function deriveOne({
  appointments,
  leaves,
  now,
  overrides,
  requests,
  technician,
}: {
  appointments: Appointment[];
  leaves: PresenceLeave[];
  now: Date;
  overrides: PresenceOverride[];
  requests: DispatchRequest[];
  technician: Technician;
}): TechnicianPresence {
  const candidates: PresenceCandidate[] = [];

  for (const leave of leaves) {
    if (isActiveIsoRange(leave.startsAt, leave.endsAt, now)) {
      candidates.push({
        context: leave.label,
        endsAt: leave.endsAt,
        label: STATUS_LABEL.leave,
        source: leave.source,
        startsAt: leave.startsAt,
        status: "leave",
      });
    }
  }

  for (const override of overrides) {
    if (
      !override.clearedAt &&
      isActiveIsoRange(override.startsAt, override.endsAt, now)
    ) {
      candidates.push({
        context:
          override.status === "lunch"
            ? "Lunch break"
            : override.reason || "Unavailable",
        endsAt: override.endsAt,
        label: STATUS_LABEL[override.status],
        source: "manual_override",
        startsAt: override.startsAt,
        status: override.status,
      });
    }
  }

  for (const appointment of appointments) {
    candidates.push(
      ...appointmentCandidates({
        appointment,
        now,
        request: requests.find((request) => request.id === appointment.requestId),
        technician,
      }),
    );
  }

  const fallback: PresenceCandidate = officeIsOpen(now)
    ? {
        context:
          technician.baseOfficeName ??
          technician.storeLocation ??
          technician.baseOfficeId ??
          "Office",
        label: STATUS_LABEL.in_office,
        source: "schedule",
        status: "in_office",
      }
    : {
        context: "Outside office hours",
        label: STATUS_LABEL.closed,
        source: "schedule",
        status: "closed",
      };
  candidates.push(fallback);
  candidates.sort(
    (first, second) =>
      STATUS_PRIORITY[first.status] - STATUS_PRIORITY[second.status],
  );
  const selected = candidates[0] ?? fallback;
  const conflicts = Array.from(
    new Set(
      candidates
        .slice(1)
        .filter(
          (candidate) =>
            candidate.status !== "in_office" && candidate.status !== "closed",
        )
        .map((candidate) => STATUS_LABEL[candidate.status]),
    ),
  );
  const remainingMinutes = selected.endsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(selected.endsAt).getTime() - now.getTime()) / 60_000,
        ),
      )
    : undefined;

  return {
    ...selected,
    conflicts,
    remainingMinutes,
    technicianId: technician.id,
  };
}

function appointmentCandidates({
  appointment,
  now,
  request,
  technician,
}: {
  appointment: Appointment;
  now: Date;
  request?: DispatchRequest;
  technician: Technician;
}): PresenceCandidate[] {
  const dateKey = appointment.date ?? appointment.start.slice(0, 10);
  if (dateKey !== todayDateKey(now)) {
    return [];
  }

  const nowMinutes = currentMelbourneMinutes(now);
  const startMinutes = minutesFromTime(appointment.start);
  const endMinutes = minutesFromTime(appointment.end);
  const activeJob = inRange(nowMinutes, startMinutes, endMinutes);
  const showAs = appointment.outlookShowAs?.toLowerCase();

  if (showAs === "free") {
    return [];
  }

  if (
    activeJob &&
    appointment.isAllDay &&
    looksLikeLeave(appointment.title)
  ) {
    return [
      appointmentCandidate({
        appointment,
        context: safeLeaveLabel(appointment.title),
        source: "outlook",
        status: "leave",
      }),
    ];
  }

  if (
    activeJob &&
    showAs === "oof" &&
    (appointment.isAllDay || looksLikeLeave(appointment.title))
  ) {
    return [
      appointmentCandidate({
        appointment,
        context: safeLeaveLabel(appointment.title),
        source: "outlook",
        status: "leave",
      }),
    ];
  }

  if (activeJob && isPersonalAppointment(appointment)) {
    return [
      appointmentCandidate({
        appointment,
        context: "Personal",
        source: "outlook",
        status: "personal",
      }),
    ];
  }

  const bookingType =
    appointment.bookingType ??
    request?.bookingType ??
    (request?.onsite === false ? "Remote" : request?.onsite ? "Onsite" : undefined);
  const appointmentSource =
    appointment.source === "outlook" ? "outlook" : "schedule";

  if (
    activeJob &&
    appointment.source === "outlook" &&
    !bookingType &&
    !appointment.isAllDay
  ) {
    return [
      appointmentCandidate({
        appointment,
        context: appointment.title || "Meeting",
        source: "outlook",
        status: "meeting",
      }),
    ];
  }

  if (
    activeJob &&
    (bookingType === "Remote" || bookingType === "In house")
  ) {
    return [
      appointmentCandidate({
        appointment,
        context: `${bookingType}: ${
          appointment.customer || request?.customer || appointment.title
        }`,
        source: appointmentSource,
        status: "in_office",
      }),
    ];
  }

  if (bookingType !== "Onsite") {
    return [];
  }

  const candidates: PresenceCandidate[] = [];
  const travelTo = appointment.travelToSiteMinutes ?? 0;
  const travelBack = appointment.travelBackToOfficeMinutes ?? 0;

  if (travelTo > 0 && inRange(nowMinutes, startMinutes - travelTo, startMinutes)) {
    candidates.push(
      appointmentCandidate({
        appointment,
        context: `To ${appointment.customer || request?.customer || "site"}`,
        endTime: appointment.start,
        source: appointmentSource,
        startTime: timeFromMinutes(startMinutes - travelTo),
        status: "driving",
      }),
    );
  }

  if (activeJob) {
    const site = request?.site ? ` / ${request.site}` : "";
    candidates.push(
      appointmentCandidate({
        appointment,
        context: `${appointment.customer || request?.customer || "Customer"}${site}`,
        source: appointmentSource,
        status: "on_site",
      }),
    );
  }

  if (travelBack > 0 && inRange(nowMinutes, endMinutes, endMinutes + travelBack)) {
    candidates.push(
      appointmentCandidate({
        appointment,
        context: `Returning to ${
          technician.baseOfficeName ?? technician.storeLocation ?? "office"
        }`,
        endTime: timeFromMinutes(endMinutes + travelBack),
        source: appointmentSource,
        startTime: appointment.end,
        status: "driving",
      }),
    );
  }

  return candidates;
}

function appointmentCandidate({
  appointment,
  context,
  endTime = appointment.end,
  source,
  startTime = appointment.start,
  status,
}: {
  appointment: Appointment;
  context: string;
  endTime?: string;
  source: PresenceCandidate["source"];
  startTime?: string;
  status: PresenceStatus;
}): PresenceCandidate {
  const dateKey = appointment.date ?? appointment.start.slice(0, 10);

  return {
    context,
    endsAt: melbourneLocalTimestamp(dateKey, endTime),
    label: STATUS_LABEL[status],
    source,
    startsAt: melbourneLocalTimestamp(dateKey, startTime),
    status,
  };
}

function isPersonalAppointment(appointment: Appointment) {
  const sensitivity = appointment.outlookSensitivity?.toLowerCase();
  return (
    appointment.outlookIssue === "private" ||
    ["confidential", "personal", "private"].includes(sensitivity ?? "") ||
    appointment.outlookCategories?.some(
      (category) => category.trim().toLowerCase() === "personal",
    ) === true
  );
}

function looksLikeLeave(title: string) {
  return /\b(annual leave|sick|leave|out of office|ooo|unavailable)\b/i.test(
    title,
  );
}

function safeLeaveLabel(title: string) {
  if (/\bsick\b/i.test(title)) return "Sick leave";
  if (/\bannual leave\b/i.test(title)) return "Annual leave";
  return "Leave";
}

function isActiveIsoRange(startsAt: string, endsAt: string, now: Date) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return start <= now.getTime() && now.getTime() < end;
}

function currentMelbourneMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

function officeIsOpen(now: Date) {
  const weekday = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
  }).format(now);
  const minutes = currentMelbourneMinutes(now);

  return (
    weekday !== "Sat" &&
    weekday !== "Sun" &&
    minutes >= 9 * 60 &&
    minutes < 17 * 60
  );
}

function melbourneLocalTimestamp(dateKey: string, time: string) {
  const offset = melbourneOffset(dateKey, time);
  return `${dateKey}T${time.slice(0, 5)}:00${offset}`;
}

function melbourneOffset(dateKey: string, time: string) {
  const guess = new Date(`${dateKey}T${time.slice(0, 5)}:00Z`);
  const zoneName =
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne",
      timeZoneName: "longOffset",
    })
      .formatToParts(guess)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+10:00";
  const match = zoneName.match(/GMT([+-]\d{2}:\d{2})/);
  return match?.[1] ?? "+10:00";
}

function minutesFromTime(time: string) {
  const [hours = 0, minutes = 0] = time.slice(-5).split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(total: number) {
  const bounded = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(
    bounded % 60,
  ).padStart(2, "0")}`;
}

function inRange(value: number, start: number, end: number) {
  return start <= value && value < end;
}

function technicianEmail(technician: Technician) {
  return technician.zohoEmail ?? technician.outlookEmail;
}

function sameEmail(first: string, second: string) {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}
