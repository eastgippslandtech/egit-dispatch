import { describe, expect, it } from "vitest";

import {
  extractLinkedRequestNumber,
  mapGraphEventToAppointment,
} from "./mappers";
import type { MicrosoftGraphEvent } from "./types";
import type { Technician } from "@/server/dispatch/types";

const technician: Technician = {
  active: true,
  baseOfficeId: "bairnsdale",
  calendarEnabled: true,
  displayName: "Simeon",
  id: "tech-simeon",
  mappingStatus: "mapped",
  outlookEmail: "simeon@egit.com.au",
  storeLocation: "Bairnsdale",
};

function event(overrides: Partial<MicrosoftGraphEvent> = {}): MicrosoftGraphEvent {
  return {
    attendees: [],
    bodyPreview: "REQ-100211 needs onsite work",
    end: { dateTime: "2026-07-08T10:30:00", timeZone: "AUS Eastern Standard Time" },
    id: "event-1",
    isAllDay: false,
    lastModifiedDateTime: "2026-07-07T23:00:00Z",
    location: { displayName: "OneHarvest server room" },
    organizer: {
      emailAddress: {
        address: "dispatcher@egit.com.au",
        name: "Dispatcher",
      },
    },
    sensitivity: "normal",
    showAs: "busy",
    start: { dateTime: "2026-07-08T09:30:00", timeZone: "AUS Eastern Standard Time" },
    subject: "REQ-100211 File server disk expansion",
    webLink: "https://outlook.office.com/calendar/item/event-1",
    ...overrides,
  };
}

describe("Graph event mapper", () => {
  it("extracts ServiceDesk request numbers from subject or body preview", () => {
    expect(extractLinkedRequestNumber("REQ-100211 Server work")).toBe("100211");
    expect(extractLinkedRequestNumber("SDP 100246 upgrade")).toBe("100246");
    expect(extractLinkedRequestNumber("No request", "Ticket #100368")).toBe("100368");
  });

  it("maps linked Outlook events into DispatchAppointment shape", () => {
    const appointment = mapGraphEventToAppointment(event(), technician);

    expect(appointment).toMatchObject({
      calendarOwnerEmail: "simeon@egit.com.au",
      customer: "OneHarvest server room",
      date: "2026-07-08",
      end: "10:30",
      id: "outlook-tech-simeon-event-1",
      outlookEventId: "event-1",
      outlookLinkedRequestNumber: "100211",
      outlookWebLink: "https://outlook.office.com/calendar/item/event-1",
      requestId: "100211",
      source: "outlook",
      start: "09:30",
      status: "busy",
      technicianId: "tech-simeon",
      title: "REQ-100211 File server disk expansion",
    });
  });

  it("maps structured Outlook-only onsite service bookings without an MSP request", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: [
          "Ticket #237815",
          "Company: ASI Solutions",
          "Site: Gippsland office",
          "Contact: Taylor Smith",
          "Contact Phone: 03 5100 1000",
          "Address: 42 Main Street, Bairnsdale VIC 3875",
        ].join("\n"),
        location: { displayName: "On-Site" },
        subject: "ASI Solutions - ASP Work/Ticket Waiting Acceptance",
      }),
      technician,
    );

    expect(appointment).toMatchObject({
      bookingType: "Onsite",
      customer: "ASI Solutions",
      outlookLinkedRequestNumber: "237815",
      requestId: "237815",
      siteAddress: "42 Main Street, Bairnsdale VIC 3875",
    });
  });

  it("restores the selected booking type from the structured event body", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: [
          "Request: REQ-237815",
          "Company: ASI Solutions",
          "Site: Gippsland office",
          "Booking Type: Remote",
        ].join("\n"),
        location: { displayName: "42 Main Street, Bairnsdale" },
        subject: "REQ-237815 Remote support",
      }),
      technician,
    );

    expect(appointment.bookingType).toBe("Remote");
  });

  it.each([
    ["Remote", "Remote"],
    ["In-house", "In house"],
    ["in house", "In house"],
  ] as const)(
    "maps the Outlook location %s to the %s booking type",
    (location, bookingType) => {
      const appointment = mapGraphEventToAppointment(
        event({
          bodyPreview: "Ticket #237815\nCompany: ASI Solutions",
          location: { displayName: location },
          subject: "ASI Solutions service booking",
        }),
        technician,
      );

      expect(appointment).toMatchObject({
        bookingType,
        customer: "ASI Solutions",
      });
    },
  );

  it("keeps an ordinary Outlook location as useful meeting context", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: "Weekly operations review",
        location: { displayName: "Teams meeting" },
        subject: "Operations meeting",
      }),
      technician,
    );

    expect(appointment.customer).toBe("Teams meeting");
    expect(appointment.bookingType).toBeUndefined();
  });

  it("does not infer a booking type from ordinary meeting notes", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: "Discuss remote support options and upcoming on-site work",
        location: { displayName: "Teams meeting" },
        subject: "Service planning meeting",
      }),
      technician,
    );

    expect(appointment.bookingType).toBeUndefined();
  });

  it("uses the event title as context when a booking label has no Company field", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: "Ticket #237815",
        location: { displayName: "Remote" },
        subject: "ASI Solutions - Remote support session",
      }),
      technician,
    );

    expect(appointment).toMatchObject({
      bookingType: "Remote",
      customer: "ASI Solutions - Remote support session",
    });
  });

  it("maps private or limited events safely", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: undefined,
        location: undefined,
        sensitivity: "private",
        subject: undefined,
      }),
      technician,
    );

    expect(appointment.title).toBe("Private appointment");
    expect(appointment.customer).toBe("Private");
    expect(appointment.outlookIssue).toBe("private");
    expect(appointment.bodyPreview).toBeUndefined();
    expect(appointment.bookingType).toBeUndefined();
    expect(appointment.siteAddress).toBeUndefined();
  });

  it("treats personal Outlook events as redacted personal time", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: "Private medical appointment details",
        location: { displayName: "Private location" },
        sensitivity: "personal",
        subject: "Medical appointment",
      }),
      technician,
    );

    expect(appointment).toMatchObject({
      customer: "Private",
      outlookIssue: "private",
      outlookSensitivity: "personal",
      title: "Personal",
    });
    expect(appointment.bodyPreview).toBeUndefined();
    expect(appointment.outlookAttendees).toBeUndefined();
  });

  it("marks unlinked Outlook service-looking events for review", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        bodyPreview: "Install replacement firewall onsite",
        subject: "Firewall install at Decor Floors",
      }),
      technician,
    );

    expect(appointment.requestId).toBeUndefined();
    expect(appointment.outlookIssue).toBe("unlinked");
  });

  it("maps all-day events as availability blocks", () => {
    const appointment = mapGraphEventToAppointment(
      event({
        end: { dateTime: "2026-07-09T00:00:00", timeZone: "AUS Eastern Standard Time" },
        isAllDay: true,
        showAs: "oof",
        start: { dateTime: "2026-07-08T00:00:00", timeZone: "AUS Eastern Standard Time" },
        subject: "Annual leave",
      }),
      technician,
    );

    expect(appointment).toMatchObject({
      date: "2026-07-08",
      end: "17:00",
      isAllDay: true,
      outlookIssue: "all-day",
      start: "09:00",
      status: "busy",
      title: "Annual leave",
    });
  });
});
