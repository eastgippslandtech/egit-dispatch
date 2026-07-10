import { describe, expect, it } from "vitest";

import { readDispatchConfig } from "./env";
import { getDispatchDashboardData } from "./provider";

describe("dispatch dashboard provider", () => {
  it("serves the locked Command Centre from mock data by default", async () => {
    const data = await getDispatchDashboardData(readDispatchConfig({}));

    expect(data.selectedRequestId).toBe("100284");
    expect(data.technicians).toHaveLength(4);
    expect(data.healthItems.find((item) => item.key === "unscheduled")?.count).toBe(
      15,
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
    expect(data.requests.some((request) => request.requestNumber === "REQ-100284")).toBe(
      true,
    );
    expect(data.appointments.some((appointment) => appointment.source === "linked")).toBe(
      true,
    );
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
});
