import { describe, expect, it } from "vitest";

import { createPartUsedCommand } from "./parts-service";

describe("parts service", () => {
  it("rejects zero part quantity", () => {
    expect(() =>
      createPartUsedCommand({
        baseVersion: "v1",
        installationId: "inst-1",
        jobId: "firewall-riley",
        name: "Patch lead",
        occurredAt: "2026-07-09T00:00:00.000Z",
        quantity: 0,
        sku: null,
      }),
    ).toThrow("Quantity must be at least 1.");
  });
});
