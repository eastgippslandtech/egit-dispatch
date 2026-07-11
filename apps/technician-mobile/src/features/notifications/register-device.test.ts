import { describe, expect, it, vi } from "vitest";

import { createPushRegistration } from "./register-device";

describe("push registration", () => {
  it("does not request notification permission before the user opts in", async () => {
    const notifications = {
      getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[redacted]" })),
      requestPermissionsAsync: vi.fn(async () => ({ status: "granted" as const })),
    };
    const registration = createPushRegistration({ notifications });

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await registration.enableJobNotifications({
      appVersion: "0.1.0",
      installationId: "inst-1",
      platform: "ios",
    });

    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
