import { describe, expect, it } from "vitest";

import { buildDispatchHealthItems } from "./health";
import {
  buildScheduleSlot,
  detectScheduleWarnings,
  buildTimelineMarkers,
  getTimelineItemPosition,
  getTimelinePosition,
  moveAppointment,
  scheduleRequest,
  shouldShowTimelineHourLabel,
  timelinePixelToTime,
  timelinePositionToTime,
} from "./scheduling";
import type { Appointment, DispatchRequest, Technician } from "./types";

const technician: Technician = {
  id: "tech-a",
  displayName: "Alex",
  outlookEmail: "alex@example.com",
  storeLocation: "Remote",
  active: true,
  mappingStatus: "mapped",
};

const request: DispatchRequest = {
  id: "100",
  requestNumber: "REQ-100",
  subject: "Printer offline",
  customer: "OneHarvest",
  site: "Packing floor",
  requester: "Mel",
  contact: "03 5150 1000",
  priority: "High",
  status: "Ready for Scheduling",
  dueAt: "2026-07-08T11:00:00+10:00",
  ageHours: 4,
  billable: true,
  readyToBook: true,
  slaState: "due-soon",
  warnings: ["Ready to book"],
};

const appointment: Appointment = {
  id: "appt-1",
  requestId: "101",
  technicianId: "tech-a",
  title: "Existing booking",
  customer: "Internal EGIT",
  start: "10:00",
  end: "11:00",
  status: "confirmed",
  source: "linked",
};

describe("mock dispatch scheduling helpers", () => {
  it("maps horizontal timeline position to snapped schedule time", () => {
    expect(timelinePositionToTime(0, 1020)).toBe("09:00");
    expect(timelinePositionToTime(510, 1020)).toBe("13:15");
    expect(timelinePositionToTime(1020, 1020)).toBe("17:30");
  });

  it("maps fixed track pixels back to snapped schedule time", () => {
    expect(timelinePixelToTime(0)).toBe("09:00");
    expect(timelinePixelToTime(120)).toBe("10:00");
    expect(timelinePixelToTime(780)).toBe("15:30");
    expect(timelinePixelToTime(1020)).toBe("17:30");
  });

  it("positions fixed-track items in pixels from the internal track start", () => {
    expect(
      getTimelineItemPosition({ itemStart: "09:00", itemEnd: "10:00" }),
    ).toMatchObject({
      leftPx: 0,
      widthPx: 120,
    });

    expect(
      getTimelineItemPosition({ itemStart: "10:00", itemEnd: "11:00" }),
    ).toMatchObject({
      leftPx: 120,
      widthPx: 120,
    });

    expect(
      getTimelineItemPosition({ itemStart: "14:00", itemEnd: "14:30" }),
    ).toMatchObject({
      leftPx: 600,
      widthPx: 60,
    });

    expect(
      getTimelineItemPosition({ itemStart: "15:30", itemEnd: "16:30" }),
    ).toMatchObject({
      leftPx: 780,
      widthPx: 120,
    });
  });

  it("keeps the 5:30 PM end marker separate from the 5 PM hour marker", () => {
    const markers = buildTimelineMarkers();
    const fivePm = markers.find((marker) => marker.time === "17:00");
    const endCap = markers.find((marker) => marker.time === "17:30");

    expect(fivePm).toMatchObject({
      kind: "hour",
      leftPx: 960,
      minutesFromStart: 480,
    });
    expect(endCap).toMatchObject({
      kind: "end",
      leftPx: 1020,
      minutesFromStart: 510,
    });
    expect(endCap?.leftPx).not.toBe(fivePm?.leftPx);
  });

  it("hides only the 5 PM label when the final half-hour is too narrow", () => {
    expect(shouldShowTimelineHourLabel("16:00", 1_100)).toBe(true);
    expect(shouldShowTimelineHourLabel("17:00", 1_100)).toBe(false);
    expect(shouldShowTimelineHourLabel("17:00", 1_400)).toBe(true);
    expect(shouldShowTimelineHourLabel("17:30", 1_100)).toBe(true);
  });

  it("clamps fixed-track items to the internal track bounds", () => {
    expect(
      getTimelineItemPosition({ itemStart: "08:30", itemEnd: "09:30" }),
    ).toMatchObject({
      clampedEnd: "09:30",
      clampedStart: "09:00",
      leftPx: 0,
      startsBeforeTimeline: true,
      widthPx: 60,
    });

    expect(
      getTimelineItemPosition({ itemStart: "17:00", itemEnd: "18:00" }),
    ).toMatchObject({
      clampedEnd: "17:30",
      clampedStart: "17:00",
      endsAfterTimeline: true,
      leftPx: 960,
      widthPx: 60,
    });
  });

  it("joins fixed-track travel buffers to job edges exactly", () => {
    const travelTo = getTimelineItemPosition({
      itemStart: "09:45",
      itemEnd: "10:00",
    });
    const job = getTimelineItemPosition({
      itemStart: "10:00",
      itemEnd: "11:00",
    });
    const travelBack = getTimelineItemPosition({
      itemStart: "11:00",
      itemEnd: "11:15",
    });

    expect(travelTo.leftPx + travelTo.widthPx).toBe(job.leftPx);
    expect(job.leftPx + job.widthPx).toBe(travelBack.leftPx);
  });

  it("positions 9:00-10:00 at the start of the timeline", () => {
    expect(
      getTimelinePosition({ itemStart: "09:00", itemEnd: "10:00" }),
    ).toMatchObject({
      clampedEnd: "10:00",
      clampedStart: "09:00",
      isAfterTimeline: false,
      isBeforeTimeline: false,
      leftPercent: 0,
    });
    expect(
      getTimelinePosition({ itemStart: "09:00", itemEnd: "10:00" })
        .widthPercent,
    ).toBeCloseTo(11.7647, 4);
  });

  it("positions 10:00 exactly on the 10 AM grid line", () => {
    const hourPosition = getTimelinePosition({
      itemStart: "10:00",
      itemEnd: "10:00",
    });
    const appointmentPosition = getTimelinePosition({
      itemStart: "10:00",
      itemEnd: "11:00",
    });

    expect(appointmentPosition.leftPercent).toBeCloseTo(
      hourPosition.leftPercent,
      5,
    );
    expect(appointmentPosition.leftPercent).toBeCloseTo(11.7647, 4);
  });

  it("sizes 10:00-11:30 as 90 minutes of the 510 minute timeline", () => {
    const position = getTimelinePosition({
      itemStart: "10:00",
      itemEnd: "11:30",
    });

    expect(position.leftPercent).toBeCloseTo(11.7647, 4);
    expect(position.widthPercent).toBeCloseTo(17.6471, 4);
  });

  it("positions 11:30 halfway between 11 AM and 12 PM", () => {
    const eleven = getTimelinePosition({
      itemStart: "11:00",
      itemEnd: "11:00",
    });
    const elevenThirty = getTimelinePosition({
      itemStart: "11:30",
      itemEnd: "11:30",
    });
    const noon = getTimelinePosition({
      itemStart: "12:00",
      itemEnd: "12:00",
    });

    expect(elevenThirty.leftPercent).toBeCloseTo(
      (eleven.leftPercent + noon.leftPercent) / 2,
      5,
    );
  });

  it("positions 5:00-5:30 so the card ends at 100%", () => {
    const position = getTimelinePosition({
      itemStart: "17:00",
      itemEnd: "17:30",
    });

    expect(position.leftPercent + position.widthPercent).toBeCloseTo(100, 5);
  });

  it("aligns travel buffer end exactly with the job start", () => {
    const travel = getTimelinePosition({
      itemStart: "09:45",
      itemEnd: "10:00",
    });
    const job = getTimelinePosition({
      itemStart: "10:00",
      itemEnd: "11:00",
    });

    expect(travel.leftPercent + travel.widthPercent).toBeCloseTo(
      job.leftPercent,
      5,
    );
  });

  it("clamps before-hours and after-hours appointments to timeline bounds", () => {
    expect(
      getTimelinePosition({ itemStart: "08:30", itemEnd: "09:30" }),
    ).toMatchObject({
      clampedEnd: "09:30",
      clampedStart: "09:00",
      isAfterTimeline: false,
      isBeforeTimeline: true,
      leftPercent: 0,
    });

    const afterHours = getTimelinePosition({
      itemStart: "17:00",
      itemEnd: "18:00",
    });

    expect(afterHours).toMatchObject({
      clampedEnd: "17:30",
      clampedStart: "17:00",
      isAfterTimeline: true,
      isBeforeTimeline: false,
    });
    expect(afterHours.leftPercent + afterHours.widthPercent).toBeCloseTo(
      100,
      5,
    );
  });

  it("builds default one-hour slots", () => {
    expect(buildScheduleSlot("13:15", 60)).toEqual({
      start: "13:15",
      end: "14:15",
    });
  });

  it("detects overlaps and technician mapping warnings", () => {
    const warnings = detectScheduleWarnings({
      appointments: [appointment],
      end: "10:45",
      selectedDateIsPast: false,
      start: "09:45",
      technician: { ...technician, mappingStatus: "missing-sdp" },
      technicianId: "tech-a",
    });

    expect(warnings.map((warning) => warning.code)).toEqual([
      "missing-technician-mapping",
      "overlap",
    ]);
  });

  it("ignores overlap warnings on a different appointment date", () => {
    const warnings = detectScheduleWarnings({
      appointments: [{ ...appointment, date: "2026-07-08" }],
      date: "2026-07-09",
      end: "10:45",
      selectedDateIsPast: false,
      start: "09:45",
      technician,
      technicianId: "tech-a",
    });

    expect(warnings.map((warning) => warning.code)).toEqual([]);
  });

  it("detects out-of-hours and past-date warnings", () => {
    const warnings = detectScheduleWarnings({
      appointments: [],
      end: "18:00",
      selectedDateIsPast: true,
      start: "17:00",
      technician,
      technicianId: "tech-a",
    });

    expect(warnings.map((warning) => warning.code)).toEqual([
      "out-of-hours",
      "past-time",
    ]);
  });

  it("turns an unscheduled request into a mock appointment", () => {
    const appointments = scheduleRequest({
      appointmentId: "mock-1",
      appointments: [],
      durationMinutes: 60,
      request,
      start: "14:00",
      technicianId: "tech-a",
      date: "2026-07-08",
    });

    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({
      id: "mock-1",
      requestId: "100",
      technicianId: "tech-a",
      start: "14:00",
      end: "15:00",
      date: "2026-07-08",
      title: "Printer offline",
    });
  });

  it("moves an existing appointment between technicians", () => {
    const appointments = moveAppointment({
      appointmentId: "appt-1",
      appointments: [appointment],
      durationMinutes: 90,
      start: "12:30",
      technicianId: "tech-b",
      date: "2026-07-09",
    });

    expect(appointments[0]).toMatchObject({
      technicianId: "tech-b",
      start: "12:30",
      end: "14:00",
      date: "2026-07-09",
    });
  });

  it("recalculates dispatch health after scheduling", () => {
    const requests = [request];
    const before = buildDispatchHealthItems({
      appointments: [],
      requests,
      technicians: [technician],
    });
    const scheduledRequests = [
      {
        ...request,
        status: "Scheduled" as const,
        scheduledStart: "2026-07-08T14:00:00+10:00",
        scheduledEnd: "2026-07-08T15:00:00+10:00",
        readyToBook: false,
        technicianId: "tech-a",
      },
    ];
    const after = buildDispatchHealthItems({
      appointments: scheduleRequest({
        appointmentId: "mock-1",
        appointments: [],
        durationMinutes: 60,
        request,
        start: "14:00",
        technicianId: "tech-a",
      }),
      requests: scheduledRequests,
      technicians: [technician],
    });

    expect(before.find((item) => item.key === "unscheduled")?.count).toBe(1);
    expect(after.find((item) => item.key === "unscheduled")?.count).toBe(0);
  });
});
