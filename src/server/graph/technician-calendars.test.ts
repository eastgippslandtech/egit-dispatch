import { afterEach, describe, expect, it, vi } from "vitest";

import type { DispatchConfig } from "@/server/dispatch/env";
import type { Technician } from "@/server/dispatch/types";

import { readTechnicianCalendarAppointments } from "./technician-calendars";

const config: DispatchConfig = {
  appBaseUrl: "https://command.egit.com.au",
  calendarDataSource: "outlook",
  databaseUrl: undefined,
  dispatchDataSource: "msp-central",
  microsoft: {
    clientId: "client-id",
    clientSecret: "client-secret",
    tenantId: "tenant-id",
    timezone: "AUS Eastern Standard Time",
  },
  mode: "live",
  mspCentral: {
    requestWebBaseUrl: "https://helpdesk.example/requests",
  },
  timezone: "Australia/Melbourne",
  trainingSamplesEnabled: false,
};

const technicians: Technician[] = [
  technician("tech-matt", "Matt", "mattd@egit.com.au"),
  technician("tech-jervy", "Jervy", "jervy@egit.com.au"),
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("technician Outlook calendar reads", () => {
  it("keeps healthy technician calendars when one mailbox fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: "graph-token" });
        }
        if (url.includes("mattd%40egit.com.au")) {
          return Response.json({ error: "timeout" }, { status: 504 });
        }
        return Response.json({
          value: [
            {
              end: { dateTime: "2026-08-04T11:00:00", timeZone: "Australia/Melbourne" },
              id: "jervy-event",
              isAllDay: false,
              location: { displayName: "Bairnsdale" },
              start: { dateTime: "2026-08-04T10:00:00", timeZone: "Australia/Melbourne" },
              subject: "Healthy mailbox event",
            },
          ],
        });
      }),
    );

    const appointments = await readTechnicianCalendarAppointments({
      config,
      range: {
        endDateTime: "2026-08-05T00:00:00",
        startDateTime: "2026-08-04T00:00:00",
      },
      technicians,
    });

    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({
      id: "outlook-tech-jervy-jervy-event",
      technicianId: "tech-jervy",
      title: "Healthy mailbox event",
    });
  });

  it("still fails when every configured mailbox fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/oauth2/v2.0/token")
          ? Response.json({ access_token: "graph-token" })
          : Response.json({ error: "timeout" }, { status: 504 }),
      ),
    );

    await expect(
      readTechnicianCalendarAppointments({
        config,
        range: {
          endDateTime: "2026-08-05T00:00:00",
          startDateTime: "2026-08-04T00:00:00",
        },
        technicians,
      }),
    ).rejects.toThrow("Microsoft Graph calendar read failed");
  });
});

function technician(
  id: string,
  displayName: string,
  outlookEmail: string,
): Technician {
  return {
    active: true,
    baseOfficeAddress: "137 Main Street, Bairnsdale VIC 3875",
    baseOfficeId: "bairnsdale",
    baseOfficeName: "Bairnsdale",
    calendarEnabled: true,
    displayName,
    id,
    mappingStatus: "mapped",
    outlookEmail,
    outlookUserPrincipalName: outlookEmail,
  };
}
