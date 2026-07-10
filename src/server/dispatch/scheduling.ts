import type { Appointment, DispatchRequest, Technician } from "./types";
import {
  applyTravelToAppointment,
  detectTravelScheduleWarnings,
  type TravelEstimate,
} from "./travel";

export const WORKDAY_START_MINUTES = 9 * 60;
export const WORKDAY_END_MINUTES = 17 * 60 + 30;
export const TIMELINE_MINUTES = WORKDAY_END_MINUTES - WORKDAY_START_MINUTES;
export const TIMELINE_PIXELS_PER_MINUTE = 2;
export const TIMELINE_TRACK_WIDTH_PX =
  TIMELINE_MINUTES * TIMELINE_PIXELS_PER_MINUTE;
export const SNAP_MINUTES = 15;

export type ScheduleWarningCode =
  | "missing-technician-mapping"
  | "out-of-hours"
  | "overlap"
  | "past-time"
  | "travel-conflict";

export type ScheduleWarning = {
  code: ScheduleWarningCode;
  message: string;
};

export type ScheduleSlot = {
  end: string;
  start: string;
};

export type TimelinePosition = {
  clampedEnd: string;
  clampedStart: string;
  isAfterTimeline: boolean;
  isBeforeTimeline: boolean;
  leftPercent: number;
  widthPercent: number;
};

export type TimelineItemPosition = {
  clampedEnd: string;
  clampedStart: string;
  endsAfterTimeline: boolean;
  leftPx: number;
  startsBeforeTimeline: boolean;
  widthPx: number;
};

export type TimelineMarker = {
  kind: "end" | "hour";
  label: string;
  leftPx: number;
  minutesFromStart: number;
  time: string;
};

export function minutesFromTime(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeFromMinutes(totalMinutes: number) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function snapMinutes(totalMinutes: number, snap = SNAP_MINUTES) {
  return Math.round(totalMinutes / snap) * snap;
}

export function timelinePositionToTime(
  offsetPx: number,
  widthPx: number,
  snap = SNAP_MINUTES,
) {
  if (widthPx <= 0) {
    return timeFromMinutes(WORKDAY_START_MINUTES);
  }

  const ratio = offsetPx / widthPx;
  const minutes = WORKDAY_START_MINUTES + ratio * TIMELINE_MINUTES;

  return timeFromMinutes(snapMinutes(minutes, snap));
}

export function timelinePixelToTime(
  offsetPx: number,
  snap = SNAP_MINUTES,
  pixelsPerMinute = TIMELINE_PIXELS_PER_MINUTE,
) {
  const clampedOffset = Math.max(0, Math.min(TIMELINE_TRACK_WIDTH_PX, offsetPx));
  const minutes = WORKDAY_START_MINUTES + clampedOffset / pixelsPerMinute;

  return timeFromMinutes(snapMinutes(minutes, snap));
}

export function getTimelineItemPosition({
  itemEnd,
  itemStart,
  pixelsPerMinute = TIMELINE_PIXELS_PER_MINUTE,
  timelineEnd = timeFromMinutes(WORKDAY_END_MINUTES),
  timelineStart = timeFromMinutes(WORKDAY_START_MINUTES),
}: {
  itemEnd: string;
  itemStart: string;
  pixelsPerMinute?: number;
  timelineEnd?: string;
  timelineStart?: string;
}): TimelineItemPosition {
  const timelineStartMinutes = minutesFromTime(timelineStart);
  const timelineEndMinutes = minutesFromTime(timelineEnd);
  const itemStartMinutes = minutesFromTime(itemStart);
  const itemEndMinutes = minutesFromTime(itemEnd);
  const clampedStartMinutes = clampMinutes(
    itemStartMinutes,
    timelineStartMinutes,
    timelineEndMinutes,
  );
  const clampedEndMinutes = clampMinutes(
    itemEndMinutes,
    timelineStartMinutes,
    timelineEndMinutes,
  );
  const visibleStartMinutes = Math.min(clampedStartMinutes, clampedEndMinutes);
  const visibleEndMinutes = Math.max(clampedStartMinutes, clampedEndMinutes);

  return {
    clampedEnd: timeFromMinutes(visibleEndMinutes),
    clampedStart: timeFromMinutes(visibleStartMinutes),
    endsAfterTimeline: itemEndMinutes > timelineEndMinutes,
    leftPx: (visibleStartMinutes - timelineStartMinutes) * pixelsPerMinute,
    startsBeforeTimeline: itemStartMinutes < timelineStartMinutes,
    widthPx: (visibleEndMinutes - visibleStartMinutes) * pixelsPerMinute,
  };
}

export function buildTimelineMarkers({
  timelineEndMinutes = WORKDAY_END_MINUTES,
  timelineStartMinutes = WORKDAY_START_MINUTES,
  pixelsPerMinute = TIMELINE_PIXELS_PER_MINUTE,
}: {
  timelineEndMinutes?: number;
  timelineStartMinutes?: number;
  pixelsPerMinute?: number;
} = {}): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  const firstHour = Math.ceil(timelineStartMinutes / 60) * 60;

  for (
    let markerMinutes = firstHour;
    markerMinutes < timelineEndMinutes;
    markerMinutes += 60
  ) {
    markers.push({
      kind: "hour",
      label: formatTimelineMarkerLabel(markerMinutes),
      leftPx: (markerMinutes - timelineStartMinutes) * pixelsPerMinute,
      minutesFromStart: markerMinutes - timelineStartMinutes,
      time: timeFromMinutes(markerMinutes),
    });
  }

  markers.push({
    kind: "end",
    label: formatTimelineMarkerLabel(timelineEndMinutes),
    leftPx: (timelineEndMinutes - timelineStartMinutes) * pixelsPerMinute,
    minutesFromStart: timelineEndMinutes - timelineStartMinutes,
    time: timeFromMinutes(timelineEndMinutes),
  });

  return markers;
}

function formatTimelineMarkerLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? "AM" : "PM";

  return minutes === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function getTimelinePosition({
  itemEnd,
  itemStart,
  timelineEnd = timeFromMinutes(WORKDAY_END_MINUTES),
  timelineStart = timeFromMinutes(WORKDAY_START_MINUTES),
}: {
  itemEnd: string;
  itemStart: string;
  timelineEnd?: string;
  timelineStart?: string;
}): TimelinePosition {
  const pixelPosition = getTimelineItemPosition({
    itemEnd,
    itemStart,
    timelineEnd,
    timelineStart,
  });
  const timelineStartMinutes = minutesFromTime(timelineStart);
  const timelineEndMinutes = minutesFromTime(timelineEnd);
  const totalTimelineMinutes = Math.max(
    1,
    timelineEndMinutes - timelineStartMinutes,
  );
  const itemStartMinutes = minutesFromTime(itemStart);
  const itemEndMinutes = minutesFromTime(itemEnd);
  const clampedStartMinutes = clampMinutes(
    itemStartMinutes,
    timelineStartMinutes,
    timelineEndMinutes,
  );
  const clampedEndMinutes = clampMinutes(
    itemEndMinutes,
    timelineStartMinutes,
    timelineEndMinutes,
  );
  const visibleStartMinutes = Math.min(clampedStartMinutes, clampedEndMinutes);
  const visibleEndMinutes = Math.max(clampedStartMinutes, clampedEndMinutes);

  return {
    clampedEnd: pixelPosition.clampedEnd,
    clampedStart: pixelPosition.clampedStart,
    isAfterTimeline: pixelPosition.endsAfterTimeline,
    isBeforeTimeline: pixelPosition.startsBeforeTimeline,
    leftPercent:
      ((visibleStartMinutes - timelineStartMinutes) / totalTimelineMinutes) *
      100,
    widthPercent:
      ((visibleEndMinutes - visibleStartMinutes) / totalTimelineMinutes) * 100,
  };
}

export function buildScheduleSlot(start: string, durationMinutes: number) {
  return {
    start,
    end: timeFromMinutes(minutesFromTime(start) + durationMinutes),
  };
}

export function detectScheduleWarnings({
  appointmentId,
  appointments,
  end,
  selectedDateIsPast,
  start,
  technician,
  technicianId,
  date,
  travelAppointment,
}: {
  appointmentId?: string;
  appointments: Appointment[];
  date?: string;
  end: string;
  selectedDateIsPast?: boolean;
  start: string;
  technician?: Technician;
  technicianId: string;
  travelAppointment?: Appointment;
}) {
  const warnings: ScheduleWarning[] = [];
  const startMinutes = minutesFromTime(start);
  const endMinutes = minutesFromTime(end);

  if (startMinutes < WORKDAY_START_MINUTES || endMinutes > WORKDAY_END_MINUTES) {
    warnings.push({
      code: "out-of-hours",
      message: "This booking sits outside 9:00 AM to 5:30 PM.",
    });
  }

  if (technician?.mappingStatus && technician.mappingStatus !== "mapped") {
    warnings.push({
      code: "missing-technician-mapping",
      message: "This technician has an incomplete helpdesk/calendar mapping.",
    });
  }

  if (selectedDateIsPast) {
    warnings.push({
      code: "past-time",
      message: "This booking is on a past dispatch date.",
    });
  }

  const overlaps = appointments.some((appointment) => {
    if (appointment.id === appointmentId) {
      return false;
    }

    if (appointment.technicianId !== technicianId) {
      return false;
    }

    if (date && appointment.date && appointment.date !== date) {
      return false;
    }

    return startMinutes < minutesFromTime(appointment.end) &&
      minutesFromTime(appointment.start) < endMinutes;
  });

  if (overlaps) {
    warnings.push({
      code: "overlap",
      message: "This overlaps another booking for the same technician.",
    });
  }

  if (travelAppointment) {
    warnings.push(
      ...detectTravelScheduleWarnings({
        appointment: travelAppointment,
        appointments,
      }),
    );
  }

  return warnings;
}

export function scheduleRequest({
  appointmentId,
  appointments,
  durationMinutes,
  request,
  start,
  technicianId,
  date,
  travel,
}: {
  appointmentId: string;
  appointments: Appointment[];
  date?: string;
  durationMinutes: number;
  request: DispatchRequest;
  start: string;
  technicianId: string;
  travel?: TravelEstimate;
}) {
  const slot = buildScheduleSlot(start, durationMinutes);
  const appointment: Appointment = {
    id: appointmentId,
    date,
    requestId: request.id,
    technicianId,
    title: request.subject,
    customer: request.customer,
    siteAddress: request.siteAddress,
    siteArea: request.siteArea,
    siteTown: request.siteTown,
    start: slot.start,
    end: slot.end,
    status: "tentative",
    source: "linked",
  };

  return [...appointments, applyTravelToAppointment(appointment, travel)];
}

export function moveAppointment({
  appointmentId,
  appointments,
  durationMinutes,
  start,
  technicianId,
  date,
  travel,
}: {
  appointmentId: string;
  appointments: Appointment[];
  date?: string;
  durationMinutes: number;
  start: string;
  technicianId: string;
  travel?: TravelEstimate;
}) {
  const slot = buildScheduleSlot(start, durationMinutes);

  return appointments.map((appointment) =>
    appointment.id === appointmentId
      ? applyTravelToAppointment(
          {
            ...appointment,
            date: date ?? appointment.date,
            technicianId,
            start: slot.start,
            end: slot.end,
            syncIssue:
              appointment.syncIssue === "double-booked"
                ? undefined
                : appointment.syncIssue,
          },
          travel,
        )
      : appointment,
  );
}

function clampMinutes(minutes: number, start: number, end: number) {
  return Math.max(start, Math.min(end, minutes));
}
