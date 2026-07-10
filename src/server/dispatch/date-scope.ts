import type {
  Appointment,
  DispatchDashboardData,
  DispatchRequest,
  Technician,
} from "./types";

export const DISPATCH_TIMEZONE = "Australia/Melbourne";

export type ViewMode = "day" | "week";

export type WeekDay = {
  dateKey: string;
  label: string;
  shortLabel: string;
};

export function todayDateKey(now = new Date()) {
  return formatDateKey(now);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const date = dateFromDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

export function formatSelectedDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    timeZone: DISPATCH_TIMEZONE,
    weekday: "long",
    year: "numeric",
  }).format(dateFromDateKey(dateKey));
}

export function getWeekRange(dateKey: string): WeekDay[] {
  const date = dateFromDateKey(dateKey);
  const weekday = Number(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: DISPATCH_TIMEZONE,
      weekday: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "weekday")?.value
      .replace("Mon", "1")
      .replace("Tue", "2")
      .replace("Wed", "3")
      .replace("Thu", "4")
      .replace("Fri", "5")
      .replace("Sat", "6")
      .replace("Sun", "7") ?? "1",
  );
  const mondayOffset = 1 - weekday;
  const monday = addDaysToDateKey(dateKey, mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const dayKey = addDaysToDateKey(monday, index);

    return {
      dateKey: dayKey,
      label: formatSelectedDateLabel(dayKey),
      shortLabel: new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        timeZone: DISPATCH_TIMEZONE,
        weekday: "short",
      }).format(dateFromDateKey(dayKey)),
    };
  });
}

export function appointmentsForDate(
  appointments: Appointment[],
  dateKey: string,
) {
  return appointments.filter(
    (appointment) => appointmentDateKey(appointment) === dateKey,
  );
}

export function appointmentsForRange(
  appointments: Appointment[],
  dateKeys: string[],
) {
  const range = new Set(dateKeys);
  return appointments.filter((appointment) =>
    range.has(appointmentDateKey(appointment)),
  );
}

export function buildScopedDispatchData(
  data: Pick<DispatchDashboardData, "appointments" | "requests" | "technicians">,
  {
    dateKey,
    mode,
  }: {
    dateKey: string;
    mode: ViewMode;
  },
) {
  const dateKeys =
    mode === "week" ? getWeekRange(dateKey).map((day) => day.dateKey) : [dateKey];
  const inScope = new Set(dateKeys);

  return {
    appointments: appointmentsForRange(data.appointments, dateKeys),
    requests: data.requests.filter((request) =>
      requestBelongsToScope(request, inScope),
    ),
    technicians: data.technicians,
  };
}

export function groupWeekAppointments(
  appointments: Appointment[],
  technicians: Technician[],
  weekDays: WeekDay[],
) {
  const grouped: Record<string, Record<string, Appointment[]>> = {};

  for (const technician of technicians) {
    grouped[technician.id] = {};
    for (const day of weekDays) {
      grouped[technician.id][day.dateKey] = [];
    }
  }

  for (const appointment of appointments) {
    const dateKey = appointmentDateKey(appointment);
    if (!grouped[appointment.technicianId]?.[dateKey]) {
      continue;
    }
    grouped[appointment.technicianId][dateKey].push(appointment);
  }

  for (const technician of technicians) {
    for (const day of weekDays) {
      grouped[technician.id][day.dateKey].sort((first, second) =>
        first.start.localeCompare(second.start),
      );
    }
  }

  return grouped;
}

export function selectedDateIsPast(dateKey: string, now = new Date()) {
  return dateKey < todayDateKey(now);
}

export function mockIsoTime(dateKey: string, time: string) {
  return `${dateKey}T${time}:00+10:00`;
}

export function appointmentDateKey(appointment: Appointment) {
  return appointment.date ?? isoDateKey(appointment.start) ?? todayDateKey();
}

function requestBelongsToScope(
  request: DispatchRequest,
  dateKeys: Set<string>,
) {
  const scheduleDate = isoDateKey(request.scheduledStart);
  const dueDate = isoDateKey(request.dueAt);

  if (scheduleDate) {
    return dateKeys.has(scheduleDate);
  }

  return dueDate ? dateKeys.has(dueDate) : false;
}

function isoDateKey(value?: string) {
  return value?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
}

function dateFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+10:00`);
}

function formatDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: DISPATCH_TIMEZONE,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}
