import { describe, expect, it, vi } from "vitest";

import { enableWhileUsingLocation } from "./foreground-location";

describe("foreground location setup", () => {
  it("requests only while-using foreground location", async () => {
    const location = {
      requestBackgroundPermissionsAsync: vi.fn(),
      requestForegroundPermissionsAsync: vi.fn(async () => ({
        status: "granted",
      })),
      watchPositionAsync: vi.fn(),
    };

    await expect(enableWhileUsingLocation(location)).resolves.toBe(
      "Location enabled while using",
    );

    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
  });
});
