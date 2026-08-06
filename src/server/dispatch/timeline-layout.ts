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

export function buildStackedTimelineLayout(appointments: Appointment[]) {
  const sorted = [...appointments].sort((first, second) => {
    const firstWindow = getBlockedWindow(first);
    const secondWindow = getBlockedWindow(second);

    return (
      firstWindow.blockedStart.localeCompare(secondWindow.blockedStart) ||
      first.start.localeCompare(second.start)
    );
  });
  const laneEnds: string[] = [];
  const items = sorted.map((appointment) => {
    const window = getBlockedWindow(appointment);
    let lane = laneEnds.findIndex((end) => end <= window.blockedStart);

    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(window.blockedEnd);
    } else {
      laneEnds[lane] = window.blockedEnd;
    }

    const compact = appointmentDurationMinutes(appointment) <= 45;
    const cardHeight = compact ? 42 : 52;

    return {
      appointment,
      appointments: [appointment],
      cardHeight,
      compact,
      groupEnd: window.blockedEnd,
      groupStart: window.blockedStart,
      isOverlapGroup: false,
      lane,
      laneTop: 14 + lane * 58,
      overlapCount: 1,
    } satisfies TimelineLayoutItem;
  });
  const laneCount = Math.max(1, laneEnds.length);

  return {
    items,
    laneCount,
    rowHeight: Math.max(92, 28 + laneCount * 52 + (laneCount - 1) * 6),
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
