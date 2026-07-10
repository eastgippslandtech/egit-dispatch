import { getBlockedWindow } from "./travel";
import type { Appointment } from "./types";

export type TimelineLayoutItem = {
  appointment: Appointment;
  appointments: Appointment[];
  cardHeight: number;
  compact: boolean;
  groupEnd: string;
  groupStart: string;
  isOverlapGroup: boolean;
  lane: number;
  laneTop: number;
  overlapCount: number;
};

export function buildTimelineLayout(appointments: Appointment[]) {
  const groups = buildOverlapGroups(appointments);
  const items: TimelineLayoutItem[] = [];

  for (const group of groups) {
    const appointment = group.appointments[0];
    const isOverlapGroup = group.appointments.length > 1;
    const compact = !isOverlapGroup && appointmentDurationMinutes(appointment) <= 45;
    const cardHeight = compact ? 42 : 52;

    items.push({
      appointment,
      appointments: group.appointments,
      cardHeight,
      compact,
      groupEnd: group.end,
      groupStart: group.start,
      isOverlapGroup,
      lane: 0,
      laneTop: 14,
      overlapCount: group.appointments.length,
    });
  }

  return {
    items,
    laneCount: 1,
    rowHeight: 92,
  };
}

export function getTimelineAppointmentSegments(appointment: Appointment) {
  const window = getBlockedWindow(appointment);

  return {
    back: {
      end: window.blockedEnd,
      minutes: appointment.travelBackToOfficeMinutes ?? 0,
      start: appointment.end,
    },
    job: {
      end: appointment.end,
      start: appointment.start,
    },
    to: {
      end: appointment.start,
      minutes: appointment.travelToSiteMinutes ?? 0,
      start: window.blockedStart,
    },
  };
}

function appointmentDurationMinutes(appointment: Appointment) {
  return minutesFromTime(appointment.end) - minutesFromTime(appointment.start);
}

function buildOverlapGroups(appointments: Appointment[]) {
  const sorted = [...appointments].sort((first, second) => {
    const firstWindow = getBlockedWindow(first);
    const secondWindow = getBlockedWindow(second);

    return (
      firstWindow.blockedStart.localeCompare(secondWindow.blockedStart) ||
      first.start.localeCompare(second.start)
    );
  });
  const groups: Array<{
    appointments: Appointment[];
    end: string;
    start: string;
  }> = [];

  for (const appointment of sorted) {
    const window = getBlockedWindow(appointment);
    const current = groups[groups.length - 1];

    if (current && window.blockedStart < current.end) {
      current.appointments.push(appointment);
      current.end = maxTime(current.end, window.blockedEnd);
      continue;
    }

    groups.push({
      appointments: [appointment],
      end: window.blockedEnd,
      start: window.blockedStart,
    });
  }

  return groups;
}

function maxTime(first: string, second: string) {
  return first >= second ? first : second;
}

function minutesFromTime(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
