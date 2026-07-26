import { describe, expect, it } from "vitest";

import type {
  Appointment,
  DispatchRequest,
  Technician,
} from "@/server/dispatch/types";
import { deriveTechnicianPresence } from "./derive";
import type { PresenceLeave, PresenceOverride } from "./types";

const technician: Technician = {
  active: true,
  baseOfficeId: "bairnsdale",
  baseOfficeName: "Bairnsdale",
  displayName: "Jervy",
  id: "tech-jervy",
  mappingStatus: "mapped",
  outlookEmail: "jervy@egit.com.au",
  storeLocation: "Bairnsdale",
  zohoEmail: "jervy@egit.com.au",
};

const request: DispatchRequest = {
  ageHours: 2,
  billable: true,
  contact: "03 5150 1000",
  customer: "OneHarvest",
  dueAt: "2026-07-26T07:00:00Z",
  id: "100284",
  priority: "Critical",
  readyToBook: false,
  requester: "Mel Harris",
  requestNumber: "REQ-100284",
  site: "Bairnsdale packing floor",
  slaState: "normal",
  status: "Scheduled",
  subject: "Packhouse label printer offline",
  technicianId: technician.id,
  warnings: [],
};

function appointment(
  overrides: Partial<Appointment> = {},
): Appointment {
  return {
    bookingType: "Onsite",
    customer: "OneHarvest",
    date: "2026-07-26",
    end: "13:00",
    id: "appointment-1",
    requestId: request.id,
    source: "linked",
    start: "12:00",
    status: "confirmed",
    technicianId: technician.id,
    title: "Packhouse label printer offline",
    travelBackToOfficeMinutes: 15,
    travelToSiteMinutes: 15,
    ...overrides,
  };
}

function derive({
  appointments = [],
  leaves = [],
  now = new Date("2026-07-26T02:15:00.000Z"),
  overrides = [],
  requests = [request],
}: {
  appointments?: Appointment[];
  leaves?: PresenceLeave[];
  now?: Date;
  overrides?: PresenceOverride[];
  requests?: DispatchRequest[];
} = {}) {
  return deriveTechnicianPresence({
    appointments,
    leaves,
    now,
    overrides,
    requests,
    technicians: [technician],
  })[0];
}

describe("technician presence derivation", () => {
  it("defaults an unscheduled technician to their base office", () => {
    expect(derive()).toMatchObject({
      context: "Bairnsdale",
      label: "In office",
      status: "in_office",
      technicianId: "tech-jervy",
    });
  });

  it("shows Driving during onsite travel before and after a job", () => {
    expect(
      derive({
        appointments: [appointment()],
        now: new Date("2026-07-26T01:50:00.000Z"),
      }),
    ).toMatchObject({
      context: "To OneHarvest",
      status: "driving",
    });

    expect(
      derive({
        appointments: [appointment()],
        now: new Date("2026-07-26T03:05:00.000Z"),
      }),
    ).toMatchObject({
      context: "Returning to Bairnsdale",
      status: "driving",
    });
  });

  it("shows On site during an onsite job", () => {
    expect(derive({ appointments: [appointment()] })).toMatchObject({
      context: "OneHarvest / Bairnsdale packing floor",
      endsAt: "2026-07-26T13:00:00+10:00",
      label: "On site",
      status: "on_site",
    });
  });

  it("keeps Remote and In house ticket work in office", () => {
    for (const bookingType of ["Remote", "In house"] as const) {
      expect(
        derive({ appointments: [appointment({ bookingType })] }),
      ).toMatchObject({
        status: "in_office",
      });
    }
  });

  it("shows a safe Personal state for private or personal Outlook time", () => {
    const result = derive({
      appointments: [
        appointment({
          bodyPreview: undefined,
          customer: "Private",
          outlookIssue: "private",
          outlookSensitivity: "personal",
          requestId: undefined,
          source: "outlook",
          title: "Personal",
        }),
      ],
      requests: [],
    });

    expect(result).toMatchObject({
      context: "Personal",
      status: "personal",
    });
    expect(JSON.stringify(result)).not.toContain("medical");
  });

  it("shows Meeting for a busy non-ticket Outlook event", () => {
    expect(
      derive({
        appointments: [
          appointment({
            bookingType: undefined,
            outlookShowAs: "busy",
            requestId: undefined,
            source: "outlook",
            title: "Operations meeting",
          }),
        ],
        requests: [],
      }),
    ).toMatchObject({
      context: "Operations meeting",
      status: "meeting",
    });
  });

  it("ignores free Outlook events", () => {
    expect(
      derive({
        appointments: [
          appointment({
            outlookShowAs: "free",
            requestId: undefined,
            source: "outlook",
          }),
        ],
        requests: [],
      }),
    ).toMatchObject({
      status: "in_office",
    });
  });

  it("expires Lunch automatically and resumes the calendar-derived state", () => {
    const lunch: PresenceOverride = {
      createdAt: "2026-07-26T02:00:00.000Z",
      createdByEmail: "jervy@egit.com.au",
      endsAt: "2026-07-26T02:30:00.000Z",
      id: "override-lunch",
      source: "technician_app",
      startsAt: "2026-07-26T02:00:00.000Z",
      status: "lunch",
      technicianEmail: "jervy@egit.com.au",
    };

    expect(
      derive({ appointments: [appointment()], overrides: [lunch] }),
    ).toMatchObject({
      remainingMinutes: 15,
      status: "lunch",
    });
    expect(
      derive({
        appointments: [appointment()],
        now: new Date("2026-07-26T02:31:00.000Z"),
        overrides: [lunch],
      }),
    ).toMatchObject({
      status: "on_site",
    });
  });

  it("gives Leave precedence over every other active state", () => {
    const leave: PresenceLeave = {
      endsAt: "2026-07-26T07:30:00.000Z",
      label: "Annual leave",
      source: "zoho_people",
      startsAt: "2026-07-25T23:00:00.000Z",
      technicianEmail: "jervy@egit.com.au",
    };

    const result = derive({
      appointments: [appointment()],
      leaves: [leave],
      overrides: [
        {
          createdAt: "2026-07-26T02:00:00.000Z",
          createdByEmail: "jervy@egit.com.au",
          endsAt: "2026-07-26T02:30:00.000Z",
          id: "override-lunch",
          source: "dispatch",
          startsAt: "2026-07-26T02:00:00.000Z",
          status: "lunch",
          technicianEmail: "jervy@egit.com.au",
        },
      ],
    });

    expect(result).toMatchObject({
      context: "Annual leave",
      status: "leave",
    });
    expect(result.conflicts).toEqual(
      expect.arrayContaining(["Lunch", "On site"]),
    );
  });

  it("uses Outlook out-of-office leave as a fallback", () => {
    expect(
      derive({
        appointments: [
          appointment({
            isAllDay: true,
            outlookShowAs: "oof",
            requestId: undefined,
            source: "outlook",
            start: "09:00",
            end: "17:30",
            title: "Sick leave",
          }),
        ],
        requests: [],
      }),
    ).toMatchObject({
      context: "Sick leave",
      status: "leave",
    });
  });

  it("reports lower-priority overlapping activities without leaking Personal details", () => {
    const result = derive({
      appointments: [
        appointment(),
        appointment({
          id: "private-event",
          outlookIssue: "private",
          outlookSensitivity: "private",
          requestId: undefined,
          source: "outlook",
          title: "Private appointment",
        }),
      ],
    });

    expect(result).toMatchObject({ status: "on_site" });
    expect(result.conflicts).toContain("Personal");
    expect(result.conflicts.join(" ")).not.toContain("Private appointment");
  });
});
