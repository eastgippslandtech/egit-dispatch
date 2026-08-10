import { describe, expect, it, vi } from "vitest";

import { enableWhileUsingLocation } from "./foreground-location";

describe("foreground location setup", () => {
  it("requests only while-using foreground location", async () => {
    const location = {
      getForegroundPermissionsAsync: vi.fn(async () => ({
        canAskAgain: true,
        granted: false,
        status: "undetermined",
      })),
      requestBackgroundPermissionsAsync: vi.fn(),
      requestForegroundPermissionsAsync: vi.fn(async () => ({
        canAskAgain: true,
        granted: true,
        status: "granted",
      })),
      watchPositionAsync: vi.fn(),
    };

    await expect(enableWhileUsingLocation(location)).resolves.toBe(
      "Location enabled while using",
    );

    expect(location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("opens app settings when the OS cannot show the location prompt again", async () => {
    const location = {
      getForegroundPermissionsAsync: vi.fn(async () => ({
        canAskAgain: false,
        granted: false,
        status: "denied",
      })),
      requestForegroundPermissionsAsync: vi.fn(async () => ({
        canAskAgain: false,
        granted: false,
        status: "denied",
      })),
    };
    const openSettings = vi.fn(async () => undefined);

    await expect(
      enableWhileUsingLocation(location, { openSettings }),
    ).resolves.toBe("Open phone settings to enable location while using");

    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("opens app settings when iOS reports a denied location without retry metadata", async () => {
    const location = {
      getForegroundPermissionsAsync: vi.fn(async () => ({
        granted: false,
        status: "denied",
      })),
      requestForegroundPermissionsAsync: vi.fn(async () => ({
        granted: false,
        status: "denied",
      })),
    };
    const openSettings = vi.fn(async () => undefined);

    await expect(
      enableWhileUsingLocation(location, { openSettings }),
    ).resolves.toBe("Open phone settings to enable location while using");

    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
