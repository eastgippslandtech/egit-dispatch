import { describe, expect, it } from "vitest";

import {
  addDaysToDateKey,
  appointmentsForDate,
  buildScopedDispatchData,
  formatSelectedDateLabel,
  getWeekRange,
  groupWeekAppointments,
  todayDateKey,
} from "./date-scope";
import type {
  Appointment,
  DispatchDashboardData,
  DispatchRequest,
  Technician,
} from "./types";

const technicians: Technician[] = [
  {
    id: "tech-a",
    active: true,
    displayName: "Alex",
    mappingStatus: "mapped",
    outlookEmail: "alex@example.com",
    storeLocation: "Remote",
  },
  {
    id: "tech-b",
    active: true,
    displayName: "Blair",
    mappingStatus: "mapped",
    outlookEmail: "blair@example.com",
    storeLocation: "Bairnsdale",
  },
];

const requestBase: DispatchRequest = {
  id: "100",
  requestNumber: "REQ-100",
  subject: "Printer offline",
  customer: "OneHarvest",
  site: "Packing floor",
  requester: "Mel",
  contact: "03 5150 1000",
  priority: "High",
  status: "Open",
  dueAt: "2026-07-08T11:00:00+10:00",
  ageHours: 4,
  billable: true,
  readyToBook: true,
  slaState: "due-soon",
  warnings: ["Ready to book"],
};

const appointments: Appointment[] = [
  {
    id: "appt-tue",
    customer: "OneHarvest",
    date: "2026-07-07",
    end: "10:00",
    source: "linked",
    start: "09:00",
    status: "confirmed",
    technicianId: "tech-a",
    title: "Tuesday job",
  },
  {
    id: "appt-wed",
    customer: "Decor Floors",
    date: "2026-07-08",
    end: "12:00",
    source: "linked",
    start: "11:00",
    status: "confirmed",
    technicianId: "tech-b",
    title: "Wednesday job",
  },
];

const dashboard: DispatchDashboardData = {
  appointments,
  healthItems: [],
  requests: [
    {
      ...requestBase,
      id: "100",
      requestNumber: "REQ-100",
      dueAt: "2026-07-08T11:00:00+10:00",
    },
    {
      ...requestBase,
      id: "101",
      requestNumber: "REQ-101",
      readyToBook: false,
      scheduledStart: "2026-07-07T09:00:00+10:00",
      scheduledEnd: "2026-07-07T10:00:00+10:00",
      status: "Scheduled",
    },
  ],
  selectedDateLabel: "Wednesday 8 July 2026",
  selectedRequestId: "100",
  technicians,
  timezone: "Australia/Melbourne",
};

describe("dispatch date scoping", () => {
  it("formats the selected date in Australia/Melbourne", () => {
    expect(formatSelectedDateLabel("2026-07-07")).toBe("Tuesday 7 July 2026");
  });

  it("calculates previous, next, and today date keys", () => {
    expect(addDaysToDateKey("2026-07-08", -1)).toBe("2026-07-07");
    expect(addDaysToDateKey("2026-07-08", 1)).toBe("2026-07-09");
    expect(todayDateKey(new Date("2026-07-08T01:00:00Z"))).toBe("2026-07-08");
  });

  it("calculates a Monday-start week range", () => {
    expect(getWeekRange("2026-07-08").map((day) => day.dateKey)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
  });

  it("filters day view appointments to the selected date", () => {
    expect(appointmentsForDate(appointments, "2026-07-08")).toEqual([
      appointments[1],
    ]);
  });

  it("builds daily scoped health data from selected date appointments and requests", () => {
    const scoped = buildScopedDispatchData(dashboard, {
      dateKey: "2026-07-07",
      mode: "day",
    });

    expect(scoped.appointments.map((appointment) => appointment.id)).toEqual([
      "appt-tue",
    ]);
    expect(scoped.requests.map((request) => request.id)).toEqual(["101"]);
  });

  it("builds weekly scoped health data across the selected week", () => {
    const scoped = buildScopedDispatchData(dashboard, {
      dateKey: "2026-07-08",
      mode: "week",
    });

    expect(scoped.appointments.map((appointment) => appointment.id)).toEqual([
      "appt-tue",
      "appt-wed",
    ]);
    expect(scoped.requests.map((request) => request.id)).toEqual(["100", "101"]);
  });

  it("groups week appointments by technician and date", () => {
    const weekDays = getWeekRange("2026-07-08");
    const grouped = groupWeekAppointments(appointments, technicians, weekDays);

    expect(grouped["tech-a"]["2026-07-07"].map((item) => item.id)).toEqual([
      "appt-tue",
    ]);
    expect(grouped["tech-b"]["2026-07-08"].map((item) => item.id)).toEqual([
      "appt-wed",
    ]);
  });
});
