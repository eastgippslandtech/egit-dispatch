import { afterEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "./env";
import { getDispatchDashboardData } from "./provider";
import { requestMatchesDispatchQueue } from "./queue";
import type { Appointment, DispatchDashboardData, DispatchRequest, Technician } from "./types";
import type { MspCentralClient } from "@/server/msp-central/types";

const request: DispatchRequest = {
  id: "6768000001066269", requestNumber: "16168", subject: "Buchan Towing Start Up",
  ageHours: 1, billable: true, contact: "Contact", customer: "Buchan Towing",
  dueAt: "", priority: "Medium", readyToBook: false, requester: "Requester",
  site: "Buchan", slaState: "normal", status: "Scheduled", technicianId: "tech-riley", warnings: [],
};
const technician: Technician = {
  id: "tech-riley", displayName: "Riley", active: true, mappingStatus: "mapped",
  outlookEmail: "riley@egit.com.au", storeLocation: "Bairnsdale",
};
const savedBooking: Appointment = {
  id: "saved-link", requestId: request.id, scheduleAssignmentRole: "lead",
  date: "2026-12-14", start: "09:00", end: "10:00", source: "linked",
  status: "confirmed", technicianId: "database-technician-uuid", title: request.subject,
  customer: request.customer, outlookEventId: "saved-event", calendarOwnerEmail: technician.outlookEmail,
};

async function dashboard({
  bookings = [savedBooking], calendar = [], requests = [request], failCalendar = false, failSaved = false,
}: { bookings?: Appointment[]; calendar?: Appointment[]; requests?: DispatchRequest[]; failCalendar?: boolean; failSaved?: boolean } = {}) {
  return getDispatchDashboardData(readDispatchConfig({
    DISPATCH_DATA_SOURCE: "msp-central", CALENDAR_DATA_SOURCE: "outlook",
  }), {
    crmClient: null,
    database: {
      getDashboardData: async () => {
        if (failSaved) throw new Error("Saved schedules unavailable");
        return { appointments: bookings, requests: [], technicians: [{ ...technician, id: "database-technician-uuid" }] };
      },
    },
    mspClient: { listRequests: async () => requests, listTechnicians: async () => [technician] } as unknown as MspCentralClient,
    outlookLoader: async ({ mockData }) => {
      if (failCalendar) throw new Error("Calendar unavailable");
      return { ...mockData, appointments: calendar, calendarDataSource: "outlook", calendarReadOnly: false } as DispatchDashboardData;
    },
    integrationRepository: { enqueue: vi.fn() },
  });
}

describe("booking persistence and daily rebooking", () => {
  afterEach(() => vi.useRealTimers());

  function on(date: string) { vi.useFakeTimers(); vi.setSystemTime(new Date(date)); }

  it("keeps a saved forward booking outside the two-week calendar window across Monday refreshes", async () => {
    for (const today of ["2026-11-23T00:00:00Z", "2026-11-30T00:00:00Z", "2026-12-07T00:00:00Z"]) {
      on(today);
      const data = await dashboard();
      expect(data.requests[0].scheduledStart).toBe("2026-12-14T09:00:00+11:00");
      expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(false);
      expect(data.appointments).toEqual([expect.objectContaining({ date: "2026-12-14", technicianId: "tech-riley" })]);
    }
  });

  it("returns yesterday's open booking to rebooking but retains its calendar history and ownership", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ bookings: [{ ...savedBooking, date: "2026-11-22" }] });
    expect(data.requests[0]).toMatchObject({ readyToBook: true, needsRebooking: true, technicianId: "tech-riley" });
    expect(data.requests[0].scheduledStart).toBeUndefined();
    expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(true);
    expect(data.appointments[0]).toMatchObject({ date: "2026-11-22", syncIssue: "past-open" });
  });

  it("waits until the next Melbourne calendar day, rather than the end time or UTC midnight", async () => {
    on("2026-11-23T12:59:00Z"); // 23:59 Melbourne
    expect((await dashboard({ bookings: [{ ...savedBooking, date: "2026-11-23" }] })).requests[0].scheduledStart).toBeDefined();
    on("2026-11-23T13:00:00Z"); // 00:00 Tuesday
    expect((await dashboard({ bookings: [{ ...savedBooking, date: "2026-11-23" }] })).requests[0].scheduledStart).toBeUndefined();
  });

  it("prefers a saved future booking over an old calendar slot and keeps the ticket out of rebooking", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ calendar: [{ ...savedBooking, id: "old", date: "2026-11-20", technicianId: technician.id, outlookEventId: "old-event" }] });
    expect(data.requests[0].scheduledStart).toBe("2026-12-14T09:00:00+11:00");
    expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(false);
  });

  it("uses the real Outlook time when a saved event has been moved", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ calendar: [{ ...savedBooking, date: "2026-11-24", start: "13:00", end: "14:00", technicianId: technician.id }] });
    expect(data.requests[0].scheduledStart).toBe("2026-11-24T13:00:00+11:00");
    expect(data.appointments).toHaveLength(1);
  });

  it("does not put resolved or cancelled tickets back in the queue", async () => {
    on("2026-11-23T00:00:00Z");
    for (const status of ["Resolved", "Cancelled"] as const) {
      const data = await dashboard({ requests: [{ ...request, status }], bookings: [{ ...savedBooking, date: "2026-11-20" }] });
      expect(data.requests[0].readyToBook).toBe(false);
      expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(false);
      expect(data.appointments).toEqual([]);
    }
  });

  it("keeps saved future slots during calendar failure without claiming calendar confirmation", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ failCalendar: true });
    expect(data.requests[0].scheduledStart).toBeDefined();
    expect(data.calendarError).toContain("Outlook calendar read failed");
    expect(data.appointments[0]).toMatchObject({ syncIssue: "missing-calendar", source: "sdp" });
  });

  it("rolls over calendar-only past bookings even when saved schedule storage fails", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ failSaved: true, calendar: [{ ...savedBooking, date: "2026-11-22", technicianId: technician.id }] });
    expect(data.requests[0].scheduledStart).toBeUndefined();
    expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(true);
    expect(data.calendarError).toContain("Saved booking");
  });

  it("does not replace the current MSP owner with an older saved calendar assignment", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ requests: [{ ...request, technicianId: "tech-matt" }] });
    expect(data.requests[0].technicianId).toBe("tech-matt");
    expect(data.appointments.every((appointment) => appointment.technicianId === "tech-riley")).toBe(true);
  });

  it("links a saved event by provider ID even after its Outlook title was edited", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ calendar: [{
      ...savedBooking, requestId: undefined, title: "Onsite visit", date: "2026-11-24", technicianId: technician.id,
    }] });
    expect(data.requests[0].scheduledStart).toBe("2026-11-24T09:00:00+11:00");
    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0]).toMatchObject({ requestId: request.id, outlookEventId: "saved-event" });
  });

  it("preserves an explicit future MSP booking over stale saved history", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({
      requests: [{ ...request, scheduledStart: "2026-12-14T09:00:00+11:00", scheduledEnd: "2026-12-14T10:00:00+11:00" }],
      bookings: [{ ...savedBooking, date: "2026-11-20" }],
      calendar: [{ ...savedBooking, date: "2026-11-20", technicianId: technician.id }],
    });
    expect(data.requests[0].scheduledStart).toBe("2026-12-14T09:00:00+11:00");
    expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(false);
  });

  it("keeps a newer Outlook forward slot and past history when saved and MSP times are old", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({
      requests: [{ ...request, scheduledStart: "2026-11-20T09:00:00+11:00", scheduledEnd: "2026-11-20T10:00:00+11:00" }],
      bookings: [{ ...savedBooking, date: "2026-11-20" }],
      calendar: [
        { ...savedBooking, date: "2026-11-20", technicianId: technician.id },
        { ...savedBooking, id: "forward", outlookEventId: "new-forward-event", date: "2026-11-24", technicianId: technician.id },
      ],
    });
    expect(data.requests[0].scheduledStart).toBe("2026-11-24T09:00:00+11:00");
    expect(data.appointments).toHaveLength(2);
    expect(requestMatchesDispatchQueue(data.requests[0], "new")).toBe(false);
  });

  it("retains an unmapped current MSP owner instead of assigning the historical calendar technician", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ requests: [{ ...request, technicianId: undefined, mspCentralTechnicianId: "unmapped-msp-owner" }] });
    expect(data.requests[0].technicianId).toBeUndefined();
    expect(data.requests[0].mspCentralTechnicianId).toBe("unmapped-msp-owner");
    expect(data.requests[0].scheduledStart).toBeDefined();
  });

  it("rolls over an exact Outlook event moved into the past while MSP still has the saved original dates", async () => {
    on("2026-11-25T00:00:00Z");
    const data = await dashboard({
      requests: [{ ...request, scheduledStart: "2026-12-14T09:00:00+11:00", scheduledEnd: "2026-12-14T10:00:00+11:00" }],
      calendar: [{ ...savedBooking, date: "2026-11-23", technicianId: technician.id }],
    });
    expect(data.requests[0].scheduledStart).toBeUndefined();
    expect(data.requests[0].needsRebooking).toBe(true);
  });

  it("does not relink or reveal a saved Outlook event subsequently marked private", async () => {
    on("2026-11-23T00:00:00Z");
    const data = await dashboard({ calendar: [{
      ...savedBooking, requestId: undefined, technicianId: technician.id, title: "Personal",
      customer: "Personal", outlookIssue: "private", readOnly: true,
    }] });
    expect(data.appointments.find((appointment) => appointment.outlookEventId === "saved-event"))
      .toMatchObject({ title: "Personal", customer: "Personal", outlookIssue: "private", readOnly: true, requestId: undefined });
  });

  it.each(["2026-11-23", "2026-11-26", "2026-11-27"])("does not restore a conflicting saved event link dated %s to its old ticket", async (savedDate) => {
    on("2026-11-26T00:00:00Z");
    const current = { ...request, id: "6768000002950168", requestNumber: "24626", subject: "New work order" };
    const data = await dashboard({
      requests: [request, current],
      bookings: [{ ...savedBooking, date: savedDate }],
      calendar: [{ ...savedBooking, date: "2026-11-26", requestId: "24626", outlookLinkedRequestNumber: "24626", title: current.subject, bodyPreview: "Command-Centre-Booking: old-group\nRequest: 24626", technicianId: technician.id }],
    });
    expect(data.requests.find((candidate) => candidate.id === request.id)?.scheduledStart).toBeUndefined();
    expect(data.requests.find((candidate) => candidate.id === current.id)?.scheduledStart).toBe("2026-11-26T09:00:00+11:00");
    expect(data.appointments.find((appointment) => appointment.outlookEventId === "saved-event")?.requestId).toBe(current.id);
  });
});
