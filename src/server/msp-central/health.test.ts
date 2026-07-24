import { describe, expect, it } from "vitest";

import { getMspCentralReadinessStatus } from "./health";

describe("MSP Central readiness status", () => {
  it("reports safe env presence without exposing values", () => {
    const status = getMspCentralReadinessStatus({
      DISPATCH_DATA_SOURCE: "mock",
      MSP_CENTRAL_CLIENT_SECRET: "super-secret",
      MSP_CENTRAL_REFRESH_TOKEN: "refresh-secret",
    });

    expect(status.env.MSP_CENTRAL_CLIENT_SECRET).toBe(true);
    expect(status.env.MSP_CENTRAL_REFRESH_TOKEN).toBe(true);
    expect(JSON.stringify(status)).not.toContain("super-secret");
    expect(JSON.stringify(status)).not.toContain("refresh-secret");
    expect(status.liveApiAttempted).toBe(false);
  });

  it("keeps live API unattempted unless live source is selected and configured", () => {
    const status = getMspCentralReadinessStatus({
      DISPATCH_DATA_SOURCE: "msp-central-fixture",
    });

    expect(status.dataSource).toBe("msp-central-fixture");
    expect(status.mapperFixtureLoadOk).toBe(true);
    expect(status.liveApiAttempted).toBe(false);
  });

  it("reports live MSP Central mode ready when required env vars are present", () => {
    const status = getMspCentralReadinessStatus({
      DISPATCH_DATA_SOURCE: "msp-central",
      MSP_CENTRAL_BASE_URL: "https://mspcentral.manageengine.com.au",
      MSP_CENTRAL_CLIENT_ID: "client-id",
      MSP_CENTRAL_CLIENT_SECRET: "client-secret",
      MSP_CENTRAL_PORTAL: "memsp1783593801295",
      MSP_CENTRAL_REFRESH_TOKEN: "refresh-token",
    });

    expect(status.liveApiConfigured).toBe(true);
    expect(status.liveApiAttempted).toBe(true);
    expect(status.ok).toBe(true);
    expect(status.nextStep).toBe("Live MSP Central API mode is enabled.");
  });
});
