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
});
