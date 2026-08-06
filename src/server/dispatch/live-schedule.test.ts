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
