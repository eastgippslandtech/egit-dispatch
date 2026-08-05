import { afterEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "@/server/dispatch/env";
import type { Technician } from "@/server/dispatch/types";
import { readTechnicianCalendarAppointments } from "./technician-calendars";

const range = {
  endDateTime: "2026-08-05T17:00:00+10:00",
  startDateTime: "2026-08-05T09:00:00+10:00",
};

const technicians: Technician[] = [
  {
    active: true,
    calendarEnabled: true,
    displayName: "Simeon",
    id: "tech-simeon",
    mappingStatus: "mapped",
    outlookEmail: "simeon@egit.com.au",
    storeLocation: "Bairnsdale",
  },
  {
    active: true,
    calendarEnabled: true,
    displayName: "Matt",
    id: "tech-matt",
    mappingStatus: "mapped",
    outlookEmail: "matt@egit.com.au",
    outlookUserPrincipalName: "mattd@egit.com.au",
    storeLocation: "Sale",
  },
];

describe("technician Outlook calendar reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps other technician calendars when one mailbox read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        return {
          json: async () => ({ access_token: "graph-token" }),
          ok: true,
        };
      }
      if (url.includes("mattd%40egit.com.au")) {
        throw new Error("mailbox timeout");
      }
      return {
        json: async () => ({
          value: [
            {
              attendees: [],
              bodyPreview: "REQ-100211 needs onsite work",
              end: {
                dateTime: "2026-08-05T10:00:00",
                timeZone: "AUS Eastern Standard Time",
              },
              id: "event-1",
              isAllDay: false,
              location: { displayName: "Remote" },
              sensitivity: "normal",
              showAs: "busy",
              start: {
                dateTime: "2026-08-05T09:00:00",
                timeZone: "AUS Eastern Standard Time",
              },
              subject: "REQ-100211 File server disk expansion",
              webLink: "https://outlook.office.com/calendar/item/event-1",
            },
          ],
        }),
        ok: true,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const appointments = await readTechnicianCalendarAppointments({
      config: readDispatchConfig({
        MICROSOFT_CLIENT_ID: "graph-client",
        MICROSOFT_CLIENT_SECRET: "graph-secret",
        MICROSOFT_TENANT_ID: "graph-tenant",
      }),
      range,
      technicians,
    });

    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({
      id: "outlook-tech-simeon-event-1",
      technicianId: "tech-simeon",
      title: "File server disk expansion",
    });
    expect(console.error).toHaveBeenCalledWith(
      "Outlook technician calendar read failed",
      expect.objectContaining({
        technician: "Matt",
        userPrincipalName: "mattd@egit.com.au",
      }),
    );
  });

  it("still reports Outlook unavailable when every mailbox read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) {
        return {
          json: async () => ({ access_token: "graph-token" }),
          ok: true,
        };
      }
      throw new Error("mailbox timeout");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readTechnicianCalendarAppointments({
        config: readDispatchConfig({
          MICROSOFT_CLIENT_ID: "graph-client",
          MICROSOFT_CLIENT_SECRET: "graph-secret",
          MICROSOFT_TENANT_ID: "graph-tenant",
        }),
        range,
        technicians,
      }),
    ).rejects.toThrow("mailbox timeout");
  });
});
