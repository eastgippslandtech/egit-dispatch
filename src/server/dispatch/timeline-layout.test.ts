import { describe, expect, it } from "vitest";

import {
  buildStackedTimelineLayout,
  buildTimelineLayout,
  getTimelineAppointmentSegments,
} from "./timeline-layout";
import type { Appointment } from "./types";

const appointment = (override: Partial<Appointment>): Appointment => ({
  id: "appt",
  customer: "Internal EGIT",
  date: "2026-07-08",
  end: "10:00",
  source: "linked",
  start: "09:00",
  status: "confirmed",
  technicianId: "tech-a",
  title: "Job",
  ...override,
});

describe("timeline layout", () => {
  it("keeps non-overlapping appointments in lane 0", () => {
    const layout = buildTimelineLayout([
      appointment({ id: "a", start: "09:00", end: "10:00" }),
      appointment({ id: "b", start: "10:15", end: "11:00" }),
    ]);

    expect(layout.items.map((item) => [item.appointment.id, item.lane])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
    expect(layout.laneCount).toBe(1);
    expect(layout.rowHeight).toBe(92);
  });

  it("groups overlapping appointments into one readable stack item", () => {
    const layout = buildTimelineLayout([
      appointment({ id: "a", start: "10:00", end: "12:00" }),
      appointment({ id: "b", start: "11:15", end: "12:30" }),
    ]);

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      appointment: { id: "a" },
      appointments: [{ id: "a" }, { id: "b" }],
      groupEnd: "12:30",
      groupStart: "10:00",
      isOverlapGroup: true,
      overlapCount: 2,
    });
    expect(layout.laneCount).toBe(1);
    expect(layout.rowHeight).toBe(92);
  });

  it("places overlapping wallboard appointments in separate vertical lanes", () => {
    const layout = buildStackedTimelineLayout([
      appointment({ id: "a", start: "10:00", end: "12:00" }),
      appointment({ id: "b", start: "11:15", end: "12:30" }),
      appointment({ id: "c", start: "12:30", end: "13:00" }),
    ]);

    expect(layout.items.map((item) => [item.appointment.id, item.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ]);
    expect(layout.items.every((item) => !item.isOverlapGroup)).toBe(true);
    expect(layout.laneCount).toBe(2);
    expect(layout.rowHeight).toBeGreaterThan(92);
  });

  it("uses travel blocked windows when stacking wallboard appointments", () => {
    const layout = buildStackedTimelineLayout([
      appointment({
        id: "a",
        start: "10:00",
        end: "11:00",
        travelBackToOfficeMinutes: 20,
      }),
      appointment({
        id: "b",
        start: "11:15",
        end: "12:00",
      }),
    ]);

    expect(layout.items.map((item) => [item.appointment.id, item.lane])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("does not group appointments that only touch at their edges", () => {
    const layout = buildTimelineLayout([
      appointment({ id: "a", start: "09:00", end: "10:00" }),
      appointment({ id: "b", start: "10:00", end: "11:00" }),
    ]);

    expect(layout.items.map((item) => item.appointment.id)).toEqual(["a", "b"]);
    expect(layout.items.every((item) => !item.isOverlapGroup)).toBe(true);
  });

  it("keeps connected overlap chains in a single group", () => {
    const layout = buildTimelineLayout([
      appointment({ id: "a", start: "09:00", end: "10:00" }),
      appointment({ id: "b", start: "09:45", end: "10:30" }),
      appointment({ id: "c", start: "10:20", end: "11:00" }),
    ]);

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      appointment: { id: "a" },
      groupEnd: "11:00",
      groupStart: "09:00",
      overlapCount: 3,
    });
  });

  it("uses travel blocked windows when assigning lanes", () => {
    const layout = buildTimelineLayout([
      appointment({
        id: "a",
        start: "10:00",
        end: "11:00",
        travelBackToOfficeMinutes: 10,
        travelToSiteMinutes: 10,
      }),
      appointment({
        id: "b",
        start: "11:20",
        end: "12:20",
        travelToSiteMinutes: 25,
      }),
    ]);

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      appointment: { id: "a" },
      groupEnd: "12:20",
      groupStart: "09:50",
      isOverlapGroup: true,
      overlapCount: 2,
    });
  });

  it("marks compact cards for short appointments", () => {
    const layout = buildTimelineLayout([
      appointment({ id: "short", start: "09:00", end: "09:30" }),
    ]);

    expect(layout.items[0]).toMatchObject({
      cardHeight: 42,
      compact: true,
      laneTop: 14,
    });
  });

  it("places travel and job segments in one horizontal band", () => {
    const segments = getTimelineAppointmentSegments(
      appointment({
        id: "travel",
        start: "10:00",
        end: "11:00",
        travelBackToOfficeMinutes: 20,
        travelToSiteMinutes: 20,
      }),
    );

    expect(segments).toMatchObject({
      back: {
        end: "11:20",
        start: "11:00",
      },
      job: {
        end: "11:00",
        start: "10:00",
      },
      to: {
        end: "10:00",
        start: "09:40",
      },
    });
  });
});
