import { afterEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "./env";
import { getDispatchDashboardData } from "./provider";
import type { DispatchDashboardDatabase } from "./database";
import type { MspCentralClient } from "@/server/msp-central/types";

describe("dispatch dashboard provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves an empty Command Centre board by default", async () => {
    const data = await getDispatchDashboardData(readDispatchConfig({}));

    expect(data.selectedRequestId).toBe("");
    expect(data.technicians).toHaveLength(4);
    expect(data.requests).toEqual([]);
    expect(data.appointments).toEqual([]);
    expect(data.healthItems.find((item) => item.key === "unscheduled")?.count).toBe(
      0,
    );
  });

  it("keeps MSP Central data mock-only when calendar source remains mock", async () => {
    const config = readDispatchConfig({
      MOCK_INTEGRATIONS: "false",
      DATABASE_URL: "postgresql://example",
      MSP_CENTRAL_BASE_URL: "https://msp.example",
      MSP_CENTRAL_PORTAL: "egit",
      MSP_CENTRAL_CLIENT_ID: "msp-client",
      MSP_CENTRAL_CLIENT_SECRET: "msp-secret",
      MSP_CENTRAL_REFRESH_TOKEN: "msp-refresh",
      MICROSOFT_TENANT_ID: "tenant",
      MICROSOFT_CLIENT_ID: "graph-client",
      MICROSOFT_CLIENT_SECRET: "graph-secret",
    });
    const data = await getDispatchDashboardData(config);

    expect(data.calendarDataSource).toBe("mock");
    expect(data.requests).toEqual([]);
    expect(data.appointments).toEqual([]);
  });

  it("serves MSP Central fixture data when fixture mode is selected", async () => {
    const data = await getDispatchDashboardData(
      readDispatchConfig({
        DISPATCH_DATA_SOURCE: "msp-central-fixture",
        MSP_CENTRAL_REQUEST_WEB_BASE_URL:
          "https://helpdesk.example/requests/{request}",
      }),
    );

    expect(data.dispatchDataSource).toBe("msp-central-fixture");
    expect(data.requests[0]).toMatchObject({
      helpdeskUrl: "https://helpdesk.example/requests/REQ-MSP-1001",
      requestNumber: "REQ-MSP-1001",
    });
    expect(data.appointments).toEqual([]);
  });

  it("keeps the board available when live MSP Central is temporarily unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/oauth2/v2.0/token")
          ? {
              json: async () => ({ access_token: "graph-token" }),
              ok: true,
            }
          : {
              json: async () => ({ value: [] }),
              ok: true,
            },
      ),
    );
    const mspClient = {
      listRequests: async () => {
        throw new Error("OAuth refresh failed");
      },
      listTechnicians: async () => {
        throw new Error("OAuth refresh failed");
      },
    } as unknown as MspCentralClient;

    const data = await getDispatchDashboardData(
      readDispatchConfig({
        CALENDAR_DATA_SOURCE: "outlook",
        DISPATCH_DATA_SOURCE: "msp-central",
        MICROSOFT_CLIENT_ID: "graph-client",
        MICROSOFT_CLIENT_SECRET: "graph-secret",
        MICROSOFT_TENANT_ID: "graph-tenant",
        MSP_CENTRAL_BASE_URL: "https://msp.example",
        MSP_CENTRAL_PORTAL: "egit",
        MSP_CENTRAL_CLIENT_ID: "msp-client",
        MSP_CENTRAL_CLIENT_SECRET: "msp-secret",
        MSP_CENTRAL_REFRESH_TOKEN: "msp-refresh",
      }),
      { mspClient },
    );

    expect(data.dispatchDataSource).toBe("msp-central");
    expect(data.requests).toEqual([]);
    expect(data.technicians.map((technician) => technician.displayName)).toEqual(
      ["Simeon", "Matt", "Jervy", "Riley"],
    );
    expect(data.calendarError).toBe(
      "MSP Central is temporarily unavailable. Helpdesk requests could not be loaded.",
    );
  });

  it("serves dispatch from the existing Command Centre database source", async () => {
    const database: DispatchDashboardDatabase = {
      async getDashboardData() {
        return {
          appointments: [
            {
              customer: "Gippsland Legal",
              date: "2026-07-14",
              end: "11:00",
              id: "appointment-db-1",
              requestId: "request-db-1",
              source: "linked",
              start: "10:00",
              status: "confirmed",
              technicianId: "tech-riley",
              title: "VPN outage follow-up",
            },
          ],
          requests: [
            {
              ageHours: 2,
              billable: true,
              contact: "Alex Morgan",
              customer: "Gippsland Legal",
              dueAt: "2026-07-14T17:00:00.000Z",
              id: "request-db-1",
              notes: "Real Command Centre database request description.",
              priority: "High",
              readyToBook: false,
              requester: "Alex Morgan",
              requestNumber: "REQ-100900",
              scheduledEnd: "2026-07-14T11:00:00.000Z",
              scheduledStart: "2026-07-14T10:00:00.000Z",
              site: "Bairnsdale Office",
              slaState: "normal",
              sourceSystem: "command-centre-db",
              status: "Scheduled",
              subject: "VPN outage follow-up",
              technicianId: "tech-riley",
              warnings: [],
            },
          ],
          technicians: [
            {
              active: true,
              displayName: "Riley",
              mappingStatus: "mapped",
              outlookEmail: "riley@egit.com.au",
              storeLocation: "Bairnsdale",
              id: "tech-riley",
            },
          ],
        };
      },
    };

    const data = await getDispatchDashboardData(
      readDispatchConfig({
        DATABASE_URL: "postgresql://command-centre-db",
        DISPATCH_DATA_SOURCE: "command-centre-db",
      }),
      { database },
    );

    expect(data.dispatchDataSource).toBe("command-centre-db");
    expect(data.requests[0]).toMatchObject({
      notes: "Real Command Centre database request description.",
      requestNumber: "REQ-100900",
      sourceSystem: "command-centre-db",
    });
    expect(data.appointments[0]).toMatchObject({
      requestId: "request-db-1",
      source: "linked",
      technicianId: "tech-riley",
    });
  });
});
