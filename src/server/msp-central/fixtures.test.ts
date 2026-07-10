import { describe, expect, it } from "vitest";

import { readDispatchConfig } from "@/server/dispatch/env";

import {
  getMspCentralFixtureDashboardData,
  loadFixtureRequestDetail,
  loadMspCentralFixtureResponses,
} from "./fixtures";

describe("MSP Central fixtures", () => {
  it("loads synthetic sample responses", () => {
    const fixtures = loadMspCentralFixtureResponses();

    expect(fixtures.requestList.requests).toHaveLength(2);
    expect(fixtures.requestDetail.request?.request_number).toBe("REQ-MSP-1001");
    expect(fixtures.technicianList.technicians).toHaveLength(4);
  });

  it("builds fixture dashboard data without live API calls", () => {
    const data = getMspCentralFixtureDashboardData(
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
    expect(data.technicians).toHaveLength(4);
  });

  it("loads a mapped request detail fixture", () => {
    expect(loadFixtureRequestDetail()).toMatchObject({
      requestNumber: "REQ-MSP-1001",
      sourceSystem: "msp-central-fixture",
    });
  });
});
