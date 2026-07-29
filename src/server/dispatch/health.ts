import type {
  Appointment,
  DispatchDashboardData,
  HealthItem,
  Technician,
} from "./types";
import { countTravelConflicts } from "./travel";

type HealthInput = Pick<
  DispatchDashboardData,
  "appointments" | "requests" | "technicians"
>;

export function buildDispatchHealthItems(data: HealthInput): HealthItem[] {
  const unscheduled = data.requests.filter(
    (request) => !request.scheduledStart,
  );
  const readyUnscheduled = unscheduled.filter((request) => request.readyToBook);
  const appointmentIssueCount = (
    issue: NonNullable<Appointment["syncIssue"]>,
  ) => data.appointments.filter((appointment) => appointment.syncIssue === issue).length;

  return [
    {
      key: "unscheduled",
      label: "Unscheduled Requests",
      count: unscheduled.length,
      severity: "warning",
      description: "Open requests needing a technician or schedule.",
    },
    {
      key: "sla-risk",
      label: "SLA Risk",
      count: readyUnscheduled.filter((request) => request.slaState !== "normal")
        .length,
      severity: "critical",
      description: "Overdue or due within four business hours.",
    },
    {
      key: "double-booked",
      label: "Double Bookings",
      count: countDoubleBookedConflicts(data.appointments),
      severity: "critical",
      description: "Overlapping Outlook events during work hours.",
    },
    {
      key: "missing-calendar",
      label: "Missing Calendar Events",
      count: appointmentIssueCount("missing-calendar"),
      severity: "warning",
      description: "Scheduled helpdesk job missing a calendar event.",
    },
    {
      key: "time-mismatch",
      label: "Sync Issues",
      count:
        appointmentIssueCount("missing-calendar") +
        appointmentIssueCount("time-mismatch") +
        data.appointments.filter((appointment) =>
          ["private", "unlinked"].includes(appointment.outlookIssue ?? ""),
        ).length +
        missingTechnicianMappings(data.technicians),
      severity: "warning",
      description: "Helpdesk, calendar, or mapping state needs review.",
    },
    {
      key: "past-open",
      label: "Past Scheduled Open Jobs",
      count: appointmentIssueCount("past-open"),
      severity: "critical",
      description: "Scheduled jobs that have ended but remain open.",
    },
    {
      key: "mapping",
      label: "Missing Technician Mapping",
      count: missingTechnicianMappings(data.technicians),
      severity: "info",
      description: "Technician mapping is incomplete.",
    },
    {
      key: "travel-conflicts",
      label: "Travel Conflicts",
      count: countTravelConflicts(data.appointments),
      severity: "warning",
      description: "Travel buffers or estimates need dispatch review.",
    },
    {
      key: "out-of-hours",
      label: "Out-of-Hours Bookings",
      count: data.appointments.filter(isOutOfHours).length,
      severity: "warning",
      description: "Appointments outside 9:00 AM to 5:00 PM.",
    },
    {
      key: "unlinked-outlook",
      label: "Unlinked Outlook Events",
      count: data.appointments.filter(
        (appointment) => appointment.outlookIssue === "unlinked",
      ).length,
      severity: "warning",
      description: "Outlook events that look like service bookings without a request link.",
    },
    {
      key: "closed-day",
      label: "Closed-Day Bookings",
      count: data.appointments.filter(isClosedDay).length,
      severity: "warning",
      description: "Weekend or closed-day Outlook bookings.",
    },
    {
      key: "all-day-events",
      label: "All-Day Calendar Blocks",
      count: data.appointments.filter(
        (appointment) => appointment.outlookIssue === "all-day",
      ).length,
      severity: "info",
      description: "All-day Outlook events shown as availability blocks.",
    },
  ];
}

function countDoubleBookedConflicts(appointments: Appointment[]) {
  const flagged = appointments.filter((appointment) =>
    appointment.syncIssue === "double-booked" ||
    appointment.source === "outlook",
  );
  const technicianIds = Array.from(
    new Set(flagged.map((appointment) => appointment.technicianId)),
  );
  let conflicts = 0;

  for (const technicianId of technicianIds) {
    const technicianAppointments = flagged.filter(
      (appointment) => appointment.technicianId === technicianId,
    );

    for (let index = 0; index < technicianAppointments.length; index += 1) {
      for (
        let comparison = index + 1;
        comparison < technicianAppointments.length;
        comparison += 1
      ) {
        if (
          overlaps(
            technicianAppointments[index],
            technicianAppointments[comparison],
          )
        ) {
          conflicts += 1;
        }
      }
    }
  }

  return conflicts;
}

function missingTechnicianMappings(technicians: Technician[]) {
  return technicians.filter((technician) => technician.mappingStatus !== "mapped")
    .length;
}

function isOutOfHours(appointment: Appointment) {
  if (isClosedDay(appointment)) {
    return false;
  }

  return minutesSinceMidnight(appointment.start) < 9 * 60 ||
    minutesSinceMidnight(appointment.end) > 17 * 60;
}

function overlaps(first: Appointment, second: Appointment) {
  if ((first.date ?? "") !== (second.date ?? "")) {
    return false;
  }

  return minutesSinceMidnight(first.start) < minutesSinceMidnight(second.end) &&
    minutesSinceMidnight(second.start) < minutesSinceMidnight(first.end);
}

function minutesSinceMidnight(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function isClosedDay(appointment: Appointment) {
  if (appointment.outlookIssue === "closed-day") {
    return true;
  }

  const date = appointment.date;
  if (!date) {
    return false;
  }

  const weekday = new Date(`${date}T12:00:00+10:00`).getUTCDay();
  return weekday === 0 || weekday === 6;
}
