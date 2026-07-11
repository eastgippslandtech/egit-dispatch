import { describe, expect, it, vi } from "vitest";

import { createEtaService } from "./eta-service";

describe("ETA service", () => {
  it("requests a single foreground position only after Calculate ETA", async () => {
    const location = {
      getCurrentPosition: vi.fn(async () => ({
        coords: { latitude: -37.825, longitude: 147.63 },
        timestamp: Date.parse("2026-07-09T00:00:00.000Z"),
      })),
      requestForegroundPermissions: vi.fn(async () => ({ status: "granted" })),
      watchPosition: vi.fn(),
    };
    const service = createEtaService({ location });

    expect(location.getCurrentPosition).not.toHaveBeenCalled();

    await service.calculate({
      destinationAddress: "14 Main Street, Bairnsdale VIC 3875",
      travelMinutesFallback: 12,
    });

    expect(location.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(location.watchPosition).not.toHaveBeenCalled();
  });

  it("does not include coordinates in persisted ETA output", async () => {
    const service = createEtaService({
      location: {
        getCurrentPosition: async () => ({
          coords: { latitude: -37.825, longitude: 147.63 },
          timestamp: Date.parse("2026-07-09T00:00:00.000Z"),
        }),
        requestForegroundPermissions: async () => ({ status: "granted" }),
        watchPosition: vi.fn(),
      },
    });

    const result = await service.calculate({
      destinationAddress: "14 Main Street, Bairnsdale VIC 3875",
      travelMinutesFallback: 12,
    });

    expect(JSON.stringify(result.persisted)).not.toContain("-37.825");
  });
});
