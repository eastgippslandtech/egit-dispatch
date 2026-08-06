import { afterEach, describe, expect, it, vi } from "vitest";

import { readDispatchConfig } from "./env";
import { getDispatchDashboardData } from "./provider";
import type { DispatchDashboardDatabase } from "./database";
import type { MspCentralClient } from "@/server/msp-central/types";

describe("dispatch dashboard provider", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("adds local training requests without creating helpdesk records", async () => {
    const data = await getDispatchDashboardData(
      readDispatchConfig({
        COMMAND_CENTRE_TRAINING_SAMPLES: "true",
      }),
    );

    expect(data.requests).toHaveLength(8);
    expect(data.requests.every((request) => request.sourceSystem === "mock")).toBe(
      true,
    );
    expect(data.requests.map((request) => request.technicianId)).toEqual(
      expect.arrayContaining([
        "tech-simeon",
        "tech-matt",
        "tech-jervy",
        "tech-riley",
      ]),
    );
    expect(data.selectedRequestId).toBe(data.requests[0].id);
    expect(
      data.healthItems.find((item) => item.key === "unscheduled")?.count,
    ).toBe(8);
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

  it("starts Outlook while Helpdesk requests are still loading", async () => {
    let releaseRequests!: () => void;
    const requestsPending = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const mspClient = {
      listRequests: async () => {
        await requestsPending;
        return [];
      },
      listTechnicians: async () => [],
    } as unknown as MspCentralClient;
    const outlookLoader = vi.fn(async ({ mockData }) => ({
      ...mockData,
      appointments: [],
      calendarDataSource: "outlook" as const,
      calendarReadOnly: false,
      calendarStatusLabel: "Outlook Read/Write",
    }));

    const dataPromise = getDispatchDashboardData(
      readDispatchConfig({
        CALENDAR_DATA_SOURCE: "outlook",
        DISPATCH_DATA_SOURCE: "msp-central",
      }),
      { crmClient: null, mspClient, outlookLoader },
    );

    await vi.waitFor(() => expect(outlookLoader).toHaveBeenCalledOnce());
    releaseRequests();
    await expect(dataPromise).resolves.toMatchObject({
      calendarDataSource: "outlook",
      dispatchDataSource: "msp-central",
    });
  });

  it("uses the warmed MSP snapshot for dashboard reads", async () => {
    const listRequests = vi.fn(async () => []);
    const mspClient = {
      listRequests,
      listTechnicians: async () => [],
    } as unknown as MspCentralClient;

    await getDispatchDashboardData(
      readDispatchConfig({
        CALENDAR_DATA_SOURCE: "outlook",
        DISPATCH_DATA_SOURCE: "msp-central",
      }),
      {
        crmClient: null,
        mspClient,
        outlookLoader: vi.fn(async ({ mockData }) => ({
          ...mockData,
          appointments: [],
          calendarDataSource: "outlook" as const,
          calendarReadOnly: false,
          calendarStatusLabel: "Outlook Read/Write",
        })),
      },
    );

    expect(listRequests).toHaveBeenCalledWith({ cacheOnly: true });
  });

  it("keeps Helpdesk requests visible when Outlook dashboard loading stalls", async () => {
    vi.useFakeTimers();
    const mspClient = {
      listRequests: async () => [
        {
          ageHours: 2,
          billable: false,
          contact: "help@acme.example",
          customer: "Acme Health",
          dueAt: "2026-08-04T07:00:00.000Z",
          id: "request-1",
          priority: "High",
          readyToBook: true,
          requester: "Alex",
          requestNumber: "REQ-1",
          site: "Unknown site",
          slaState: "normal",
          sourceSystem: "msp-central",
          status: "Open",
          subject: "Printer offline",
          warnings: [],
        },
      ],
      listTechnicians: async () => [],
    } as unknown as MspCentralClient;

    const dataPromise = getDispatchDashboardData(
      readDispatchConfig({
        CALENDAR_DATA_SOURCE: "outlook",
        DISPATCH_DATA_SOURCE: "msp-central",
      }),
      {
        crmClient: null,
        mspClient,
        outlookLoader: vi.fn(() => new Promise(() => undefined)),
      },
    );
    await vi.advanceTimersByTimeAsync(6_001);
    const data = await dataPromise;

    expect(data.requests).toHaveLength(1);
    expect(data.calendarDataSource).toBe("outlook");
    expect(data.calendarError).toBe(
      "Outlook calendar read failed. The last Helpdesk data remains available.",
    );
  });

  it("enriches live MSP Central requests with an exact Zoho CRM account address", async () => {
    const mspClient = {
      listRequests: async () => [
        {
          ageHours: 2,
          billable: false,
          contact: "help@acme.example",
          customer: "Acme Health",
          dueAt: "2026-08-04T07:00:00.000Z",
          id: "request-1",
          priority: "High",
          readyToBook: true,
          requester: "Alex",
          requestNumber: "REQ-1",
          site: "Unknown site",
          slaState: "normal",
          sourceSystem: "msp-central",
          status: "Open",
          subject: "Printer offline",
          warnings: [],
        },
      ],
      listTechnicians: async () => [],
    } as unknown as MspCentralClient;
    const crmClient = {
      listAccounts: async () => [
        {
          Account_Name: "Acme Health",
          Shipping_City: "Sale",
          Shipping_Code: "3850",
          Shipping_State: "VIC",
          Shipping_Street: "42 Raymond Street",
          id: "crm-account-1",
        },
      ],
    };

    const data = await getDispatchDashboardData(
      readDispatchConfig({ DISPATCH_DATA_SOURCE: "msp-central" }),
      { crmClient, mspClient },
    );

    expect(data.requests[0]).toMatchObject({
      crmAccountId: "crm-account-1",
      siteAddress: "42 Raymond Street, Sale VIC 3850",
      siteAddressSource: "zoho-crm",
      siteTown: "Sale",
    });
  });

  it("keeps Helpdesk requests available when Zoho CRM address enrichment fails", async () => {
    const mspClient = {
      listRequests: async () => [
        {
          ageHours: 2,
          billable: false,
          contact: "help@acme.example",
          customer: "Acme Health",
          dueAt: "2026-08-04T07:00:00.000Z",
          id: "request-1",
          priority: "High",
          readyToBook: true,
          requester: "Alex",
          requestNumber: "REQ-1",
          site: "Unknown site",
          slaState: "normal",
          sourceSystem: "msp-central",
          status: "Open",
          subject: "Printer offline",
          warnings: [],
        },
      ],
      listTechnicians: async () => [],
    } as unknown as MspCentralClient;
    const crmClient = {
      listAccounts: async () => {
        throw new Error("CRM unavailable");
      },
    };

    const data = await getDispatchDashboardData(
      readDispatchConfig({ DISPATCH_DATA_SOURCE: "msp-central" }),
      { crmClient, mspClient },
    );

    expect(data.requests).toHaveLength(1);
    expect(data.requests[0].requestNumber).toBe("REQ-1");
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
