import { describe, expect, it, vi } from "vitest";

import { createPushRegistration } from "./register-device";

describe("push registration", () => {
  it("does not request notification permission before the user opts in", async () => {
    const notifications = {
      getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[redacted]" })),
      getPermissionsAsync: vi.fn(async () => ({ status: "undetermined" as const })),
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

  it("requests permission and registers the device during first-load setup", async () => {
    const notifications = {
      getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[first-load]" })),
      getPermissionsAsync: vi.fn(async () => ({ status: "undetermined" as const })),
      requestPermissionsAsync: vi.fn(async () => ({ status: "granted" as const })),
    };
    const registerToken = vi.fn(async () => undefined);
    const registration = createPushRegistration({ notifications, registerToken }) as
      ReturnType<typeof createPushRegistration> & {
        ensureJobNotifications: (
          input: Parameters<
            ReturnType<typeof createPushRegistration>["enableJobNotifications"]
          >[0],
        ) => Promise<{ status: string }>;
      };

    const result = await registration.ensureJobNotifications({
      appVersion: "0.1.0",
      installationId: "inst-1",
      platform: "ios",
      projectId: "expo-project-1",
    });

    expect(result.status).toBe("registered");
    expect(notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "expo-project-1",
    });
    expect(registerToken).toHaveBeenCalledWith({
      appVersion: "0.1.0",
      installationId: "inst-1",
      platform: "ios",
      pushToken: "ExponentPushToken[first-load]",
    });
  });

  it("re-registers an already-approved device without showing the prompt again", async () => {
    const notifications = {
      getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[existing]" })),
      getPermissionsAsync: vi.fn(async () => ({ status: "granted" as const })),
      requestPermissionsAsync: vi.fn(async () => ({ status: "granted" as const })),
    };
    const registerToken = vi.fn(async () => undefined);
    const registration = createPushRegistration({ notifications, registerToken }) as
      ReturnType<typeof createPushRegistration> & {
        ensureJobNotifications: (
          input: Parameters<
            ReturnType<typeof createPushRegistration>["enableJobNotifications"]
          >[0],
        ) => Promise<{ status: string }>;
      };

    await registration.ensureJobNotifications({
      appVersion: "0.1.0",
      installationId: "inst-1",
      platform: "android",
    });

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(registerToken).toHaveBeenCalledTimes(1);
  });

  it("does not request a token after notification permission is denied", async () => {
    const notifications = {
      getExpoPushTokenAsync: vi.fn(async () => ({ data: "should-not-be-used" })),
      getPermissionsAsync: vi.fn(async () => ({ status: "denied" as const })),
      requestPermissionsAsync: vi.fn(async () => ({ status: "denied" as const })),
    };
    const registerToken = vi.fn(async () => undefined);
    const registration = createPushRegistration({ notifications, registerToken }) as
      ReturnType<typeof createPushRegistration> & {
        ensureJobNotifications: (
          input: Parameters<
            ReturnType<typeof createPushRegistration>["enableJobNotifications"]
          >[0],
        ) => Promise<{ status: string }>;
      };

    const result = await registration.ensureJobNotifications({
      appVersion: "0.1.0",
      installationId: "inst-1",
      platform: "ios",
    });

    expect(result.status).toBe("not-granted");
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registerToken).not.toHaveBeenCalled();
  });
});
