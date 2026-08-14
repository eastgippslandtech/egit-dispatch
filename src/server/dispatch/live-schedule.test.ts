import { describe, expect, it } from "vitest";

import { mergeMspCentralScheduleWithOutlook } from "./live-schedule";
import type { Appointment, DispatchRequest } from "./types";

describe("live schedule linking", () => {
  it("hydrates an MSP request from a linked Outlook event using the CW ticket number", () => {
    const request = requestFixture({
      id: "6768000001411256",
      requestNumber: "6768000001411256",
      subject: "[CW 237919] Conduit Move",
    });
    const outlook = outlookFixture({
      outlookLinkedRequestNumber: "237919",
      requestId: "237919",
      title: "[CW 237919] Conduit",
    });

    const result = mergeMspCentralScheduleWithOutlook([request], [outlook]);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      readOnly: false,
      requestId: "6768000001411256",
      source: "linked",
      title: "[CW 237919] Conduit Move",
    });
    expect(result.requests[0]).toMatchObject({
      readyToBook: false,
      scheduledEnd: "2026-08-06T12:45:00+10:00",
      scheduledStart: "2026-08-06T12:00:00+10:00",
      status: "Scheduled",
      technicianId: "tech-simeon",
    });
  });

  it("links live five-digit Helpdesk request numbers from Outlook bookings", () => {
    const request = requestFixture({
      id: "6768000001422000",
      requestNumber: "22240",
      subject: "RSS sale college access",
    });
    const outlook = outlookFixture({
      outlookLinkedRequestNumber: "22240",
      requestId: "22240",
      title: "[CW 22240] RSS sale college",
    });

    const result = mergeMspCentralScheduleWithOutlook([request], [outlook]);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      readOnly: false,
      requestId: "6768000001422000",
      source: "linked",
      title: "RSS sale college access",
    });
  });

  it("creates an MSP-only appointment when a scheduled request has no calendar event", () => {
    const request = requestFixture({
      scheduledEnd: "2026-08-06T11:00:00+10:00",
      scheduledStart: "2026-08-06T10:00:00+10:00",
      technicianId: "tech-jervy",
    });

    const result = mergeMspCentralScheduleWithOutlook([request], []);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      date: "2026-08-06",
      end: "11:00",
      requestId: request.id,
      source: "sdp",
      start: "10:00",
      status: "sdp-only",
      syncIssue: "missing-calendar",
      technicianId: "tech-jervy",
    });
  });

  it("hides cancelled requests from the schedule even when stale MSP and Outlook times exist", () => {
    const request = requestFixture({
      scheduledEnd: "2026-08-06T11:00:00+10:00",
      scheduledStart: "2026-08-06T10:00:00+10:00",
      status: "Cancelled" as unknown as DispatchRequest["status"],
      technicianId: "tech-jervy",
    });
    const outlook = outlookFixture({
      calendarOwnerEmail: "jervy@egit.com.au",
      outlookLinkedRequestNumber: request.requestNumber,
      requestId: request.requestNumber,
      technicianId: "tech-jervy",
      title: `${request.requestNumber} stale booking`,
    });

    const result = mergeMspCentralScheduleWithOutlook([request], [outlook]);

    expect(result.appointments).toHaveLength(0);
    expect(result.cancelledOutlookEvents).toEqual([
      {
        eventId: "event-1",
        requestId: request.id,
        requestNumber: request.requestNumber,
        technicianId: "tech-jervy",
        userPrincipalName: "jervy@egit.com.au",
      },
    ]);
    expect(result.requests[0]).toMatchObject({
      scheduledEnd: undefined,
      scheduledStart: undefined,
      status: "Cancelled",
      technicianId: undefined,
    });
  });

  it("keeps closed requests visible on the schedule with a resolved status", () => {
    const request = requestFixture({
      scheduledEnd: "2026-08-06T11:00:00+10:00",
      scheduledStart: "2026-08-06T10:00:00+10:00",
      status: "Resolved",
      technicianId: "tech-jervy",
    });

    const result = mergeMspCentralScheduleWithOutlook([request], []);

    expect(result.appointments).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      scheduledEnd: "2026-08-06T11:00:00+10:00",
      scheduledStart: "2026-08-06T10:00:00+10:00",
      status: "Resolved",
      technicianId: "tech-jervy",
    });
  });

  it("marks Outlook ticket bookings with no active Helpdesk request for cleanup when the request list is trusted", () => {
    const outlook = outlookFixture({
      calendarOwnerEmail: "mattd@egit.com.au",
      outlookLinkedRequestNumber: "237692",
      requestId: "237692",
      technicianId: "tech-matt",
      title: "[CW 237692] CD Ripping and Burning",
    });

    const result = mergeMspCentralScheduleWithOutlook([], [outlook], {
      pruneOrphanedOutlookEvents: true,
    });

    expect(result.appointments).toEqual([]);
    expect(result.orphanedOutlookEvents).toEqual([
      {
        eventId: "event-1",
        requestNumber: "237692",
        technicianId: "tech-matt",
        userPrincipalName: "mattd@egit.com.au",
      },
    ]);
  });

  it("deduplicates matching MSP and Outlook bookings into one linked appointment", () => {
    const request = requestFixture({
      scheduledEnd: "2026-08-06T12:45:00+10:00",
      scheduledStart: "2026-08-06T12:00:00+10:00",
      technicianId: "tech-simeon",
    });
    const outlook = outlookFixture({
      outlookLinkedRequestNumber: request.requestNumber,
      requestId: request.requestNumber,
    });

    const result = mergeMspCentralScheduleWithOutlook([request], [outlook]);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      requestId: request.id,
      source: "linked",
      syncIssue: undefined,
    });
  });

  it("shows only the canonical Outlook event when a request has stale duplicate calendar bookings", () => {
    const request = requestFixture({
      id: "6768000001563242",
      requestNumber: "22401",
      scheduledEnd: "2026-08-13T12:30:00+10:00",
      scheduledStart: "2026-08-13T11:15:00+10:00",
      subject: "Network Issues",
      technicianId: "tech-jervy",
    });
    const stale = outlookFixture({
      calendarOwnerEmail: "jervy@egit.com.au",
      date: "2026-08-13",
      end: "12:15",
      id: "outlook-stale-network",
      outlookEventId: "event-stale-network",
      outlookLinkedRequestNumber: request.requestNumber,
      requestId: request.requestNumber,
      start: "11:00",
      technicianId: "tech-jervy",
      title: "Network Issues",
    });
    const current = outlookFixture({
      calendarOwnerEmail: "jervy@egit.com.au",
      date: "2026-08-13",
      end: "12:30",
      id: "outlook-current-network",
      outlookEventId: "event-current-network",
      outlookLinkedRequestNumber: request.requestNumber,
      requestId: request.requestNumber,
      start: "11:15",
      technicianId: "tech-jervy",
      title: "Network Issues",
    });

    const result = mergeMspCentralScheduleWithOutlook(
      [request],
      [stale, current],
    );

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      end: "12:30",
      outlookEventId: "event-current-network",
      requestId: request.id,
      source: "linked",
      start: "11:15",
      syncIssue: undefined,
    });
    expect(result.orphanedOutlookEvents).toEqual([
      {
        eventId: "event-stale-network",
        requestNumber: request.requestNumber,
        technicianId: "tech-jervy",
        userPrincipalName: "jervy@egit.com.au",
      },
    ]);
  });

  it("collapses duplicate Outlook-only request bookings before hydrating the request", () => {
    const request = requestFixture({
      id: "6768000001453259",
      requestNumber: "22221",
      subject: "Laptop for Treasurer",
    });
    const stale = outlookFixture({
      calendarOwnerEmail: "jervy@egit.com.au",
      end: "10:15",
      id: "outlook-stale-laptop",
      outlookEventId: "event-stale-laptop",
      outlookLinkedRequestNumber: request.requestNumber,
      requestId: request.requestNumber,
      start: "09:45",
      technicianId: "tech-jervy",
      title: "Laptop for Treasurer",
    });
    const current = outlookFixture({
      calendarOwnerEmail: "jervy@egit.com.au",
      end: "10:45",
      id: "outlook-current-laptop",
      outlookEventId: "event-current-laptop",
      outlookLinkedRequestNumber: request.requestNumber,
      requestId: request.requestNumber,
      start: "10:15",
      technicianId: "tech-jervy",
      title: "Laptop for Treasurer",
    });

    const result = mergeMspCentralScheduleWithOutlook(
      [request],
      [stale, current],
    );

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      end: "10:45",
      outlookEventId: "event-current-laptop",
      requestId: request.id,
      start: "10:15",
    });
    expect(result.requests[0]).toMatchObject({
      scheduledEnd: "2026-08-06T10:45:00+10:00",
      scheduledStart: "2026-08-06T10:15:00+10:00",
      status: "Scheduled",
      technicianId: "tech-jervy",
    });
    expect(result.orphanedOutlookEvents).toHaveLength(1);
  });

  it("leaves unrelated Outlook events as Outlook-only appointments", () => {
    const request = requestFixture({ subject: "Printer issue" });
    const outlook = outlookFixture({
      id: "outlook-meeting",
      outlookLinkedRequestNumber: undefined,
      requestId: undefined,
      title: "Team meeting",
    });

    const result = mergeMspCentralScheduleWithOutlook([request], [outlook]);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      id: "outlook-meeting",
      source: "outlook",
      title: "Team meeting",
    });
    expect(result.requests[0].scheduledStart).toBeUndefined();
  });
});

function requestFixture(
  overrides: Partial<DispatchRequest> = {},
): DispatchRequest {
  return {
    ageHours: 2,
    billable: false,
    contact: "requester@example.com",
    customer: "Business",
    dueAt: "2026-08-06T17:00:00+10:00",
    id: "6768000001410000",
    priority: "Medium",
    readyToBook: true,
    requester: "Requester",
    requestNumber: "6768000001410000",
    site: "Bairnsdale",
    slaState: "normal",
    sourceSystem: "msp-central",
    status: "Open",
    subject: "Test request",
    warnings: [],
    ...overrides,
  };
}

function outlookFixture(overrides: Partial<Appointment> = {}): Appointment {
  return {
    customer: "Outlook customer",
    date: "2026-08-06",
    end: "12:45",
    id: "outlook-tech-simeon-event-1",
    outlookEventId: "event-1",
    outlookLinkedRequestNumber: "6768000001410000",
    readOnly: false,
    requestId: "6768000001410000",
    source: "outlook",
    start: "12:00",
    status: "busy",
    technicianId: "tech-simeon",
    title: "Outlook booking",
    ...overrides,
  };
}
